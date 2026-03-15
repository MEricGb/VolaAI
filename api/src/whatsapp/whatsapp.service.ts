import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WhatsAppDirectMessageDirection,
  WhatsAppGroupMember,
  WhatsAppGroupMemberStatus,
} from '@prisma/client';
import { randomBytes } from 'crypto';
import twilio = require('twilio');
import { PrismaService } from '../db/prisma.service';
import { AddGroupMembersDto } from './dto/add-group-members.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { AgentService } from '../agent/agent.service';
import { MediaService } from '../media/media.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { ConversationPreEventDto } from './dto/conversation-pre-event.dto';

type PendingGroupAi = {
  id: string;
  conversationSid: string;
  author: string;
  senderName: string;
  userMessage: string | null;
  mediaJson: string | null;
  chatServiceSid: string | null;
  createdAt: number;
  flushed: boolean;
  timer: NodeJS.Timeout;
};

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly client: twilio.Twilio | null;
  private readonly twilioWhatsAppNumber: string | null;
  private readonly messageServiceSid: string | null;
  private readonly contentSid: string | null;
  private readonly aiTrigger: string | null;
  private readonly sandboxJoinPhrase: string | null;
  private readonly conversationChatServiceSidCache = new Map<string, string>();
  private readonly pendingGroupAi = new Map<string, PendingGroupAi[]>();
  private readonly groupAiDebounceMs = 800;
  private readonly groupAiPendingTtlMs = 8000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: AgentService,
    private readonly mediaService: MediaService,
  ) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioWhatsAppNumber = this.normalizeWhatsAppAddress(
      process.env.TWILIO_WHATSAPP_NUMBER,
    );
    this.messageServiceSid = process.env.TWILIO_MESSAGE_SERVICE_SID ?? null;
    this.contentSid = process.env.TWILIO_CONTENT_SID ?? null;
    this.aiTrigger = (process.env.TWILIO_AI_TRIGGER ?? '@vola').trim() || null;
    this.sandboxJoinPhrase =
      (process.env.TWILIO_SANDBOX_JOIN_PHRASE ?? '').trim() || null;

    if (accountSid && authToken && this.twilioWhatsAppNumber) {
      this.client = twilio(accountSid, authToken);
      return;
    }

    this.client = null;
    this.logger.warn(
      'Twilio is disabled. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER.',
    );
  }

  // ─── Incoming WhatsApp webhook (Messaging Service) ────────────────────

  async handleIncomingMessage(dto: IncomingMessageDto): Promise<string> {
    const from = this.normalizeWhatsAppAddress(dto.From);
    const body = (dto.ButtonPayload || dto.Body || '').trim();
    const profileName = dto.ProfileName?.trim() || null;

    this.logger.log(`From ${from}: "${body}" (media: ${dto.NumMedia})`);

    if (!from) {
      return this.buildTwiml('We could not identify your WhatsApp number.');
    }

    await this.upsertUser(from, profileName);

    // Handle TEAMS (list joined groups)
    const teamsMatch = body.match(/^teams$/i);
    if (teamsMatch) {
      const reply = await this.listTeams(from);
      return this.buildTwiml(reply);
    }

    // Handle USE <code> (set active group)
    const useMatch = body.match(/^use\s+([a-z0-9-]+)$/i);
    if (useMatch) {
      const joinCode = this.normalizeJoinCode(useMatch[1]);
      const reply = await this.useTeam(from, joinCode);
      return this.buildTwiml(reply);
    }

    // Handle JOIN <code>
    const joinMatch = body.match(/^join\s+([a-z0-9-]+)$/i);
    if (joinMatch) {
      const joinCode = this.normalizeJoinCode(joinMatch[1]);
      const reply = await this.joinConversation(from, joinCode, profileName);
      return this.buildTwiml(reply);
    }

    // Handle LEAVE <code>
    const leaveMatch = body.match(/^leave(?:\s+([a-z0-9-]+))?$/i);
    if (leaveMatch) {
      const joinCode = leaveMatch[1] ? this.normalizeJoinCode(leaveMatch[1]) : undefined;
      const reply = await this.leaveConversation(from, joinCode);
      return this.buildTwiml(reply);
    }

    // If user is already in an active group, we don't want to send a direct AI reply
    // because any messages they send are automatically relayed to the conversation
    // and handled by handleConversationPreEvent for the whole group.
    const activeMembership = await this.prisma.whatsAppGroupMember.findFirst({
      where: { phone: from, status: WhatsAppGroupMemberStatus.ACTIVE },
      include: { group: true },
    });

    if (activeMembership) {
      const group = (activeMembership as any).group;
      this.logger.log(`User ${from} is in active group: "${group?.name || 'Unknown'}"`);
      this.logger.log(`Active ConversationSid: ${group?.conversationSid || 'None'}`);
      this.logger.log(`Using MessagingServiceSid: ${this.messageServiceSid}`);
      this.logger.log('Skipping direct reply to let Group AI handle it.');
      return '';
    }

    this.logger.log(`User ${from} not in active group. Falling back to 1-to-1 AI.`);

    // Enforce trigger for AI responses.
    const triggerParse = this.parseAiTrigger(body);

    if (!triggerParse.triggered) {
      return this.buildTwiml(
        `To talk to the AI, start your message with ${this.aiTrigger ?? '@vola'}, for example: ${this.aiTrigger ?? '@vola'} find me flights to Rome.`,
      );
    }

    if (!triggerParse.stripped) {
      return this.buildTwiml(
        `Send ${this.aiTrigger ?? '@vola'} followed by your request, for example: ${this.aiTrigger ?? '@vola'} hotel in Paris under €150.`,
      );
    }

    // Record 1-to-1 inbound message only when it is an AI-triggered message.
    await this.recordDirectMessage(
      from,
      WhatsAppDirectMessageDirection.INBOUND,
      triggerParse.stripped,
      dto.MessageSid,
    ).catch((err) =>
      this.logger.warn(
        `[1-to-1] Failed to record inbound message: ${err?.message ?? err}`,
      ),
    );

    // Fire agent call async — Twilio times out after ~15s so we return empty TwiML
    // immediately and send the reply via the Messages API once the agent responds.
    const sessionId = `dm:${from}`;
    this.triggerAgentReplyWithMedia(from, sessionId, triggerParse.stripped, dto).catch((err) =>
      this.logger.error('1-to-1 async agent reply failed', err),
    );
    return this.buildEmptyTwiml();
  }

  private async triggerAgentReplyWithMedia(
    to: string,
    sessionId: string,
    body: string,
    dto: IncomingMessageDto,
  ): Promise<void> {
    const items = this.extractMessagingMediaItems(dto);
    let imageUrls: string[] = [];

    if (items.length > 0) {
      const webhookAccountSid = String(dto.AccountSid ?? '').trim();
      const envAccountSid = String(process.env.TWILIO_ACCOUNT_SID ?? '').trim();
      const accountSid = webhookAccountSid || envAccountSid;
      const authToken = String(process.env.TWILIO_AUTH_TOKEN ?? '').trim();

      if (webhookAccountSid && envAccountSid && webhookAccountSid !== envAccountSid) {
        this.logger.warn(
          `[media] Webhook AccountSid (${webhookAccountSid}) does not match TWILIO_ACCOUNT_SID (${envAccountSid}). Using webhook AccountSid for media download.`,
        );
      }
      if (!accountSid || !authToken) {
        this.logger.warn('[media] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing; skipping media ingest');
      } else {
        const stored = await this.mediaService.storeTwilioMessagingMedia(items, accountSid, authToken);
        imageUrls = stored.map((s) => s.url);
        this.logger.log(`[media] Stored ${imageUrls.length}/${items.length} attachments for 1-to-1`);
      }
    }

    await this.triggerAgentReply(to, sessionId, body, imageUrls);
  }

  private async triggerAgentReply(
    to: string,
    sessionId: string,
    body: string,
    imageUrls: string[] = [],
  ): Promise<void> {
    this.logger.log(
      `[1-to-1] Calling agent gRPC: session=${sessionId} message="${body}" images=${imageUrls.length}`,
    );
    let reply: string;
    try {
      let prompt = this.formatUserMessageWithImages(body, imageUrls);
      try {
        prompt = await this.buildDirectPrompt(to, prompt);
      } catch (err: any) {
        this.logger.warn(
          `[1-to-1] Failed to build context prompt, falling back to raw message: ${err?.message ?? err}`,
        );
      }
      reply = await this.agentService.chat(sessionId, prompt);
      this.logger.log(`[1-to-1] Agent replied (${reply.length} chars)`);
    } catch (err) {
      this.logger.error('Agent gRPC call failed (1-to-1)', err);
      reply = '⚠️ Our AI assistant is temporarily unavailable. Please try again shortly.';
    }

    if (!this.client || !this.twilioWhatsAppNumber) {
      this.logger.warn('[1-to-1] Twilio client not configured, cannot send reply');
      return;
    }

    this.logger.log(`[1-to-1] Sending reply via Messages API to ${to}`);
    const result = await this.client.messages.create({
      from: this.twilioWhatsAppNumber,
      to,
      body: reply,
    });
    await this.recordDirectMessage(
      to,
      WhatsAppDirectMessageDirection.OUTBOUND,
      reply,
      result.sid,
    ).catch((err) =>
      this.logger.warn(`[1-to-1] Failed to record outbound message: ${err?.message ?? err}`),
    );
    this.logger.log(`[1-to-1] Reply sent`);
  }

  // ─── Conversations pre-event webhook (onMessageAdd) ───────────────────

  async handleConversationPreEvent(dto: ConversationPreEventDto) {
    this.logger.log(`Conversation Event [${dto.EventType}] from ${dto.Author}`);

    if (dto.EventType !== 'onMessageAdd') {
      return { body: dto.Body ?? '' };
    }

    // Skip system messages
    if (dto.Author === 'system') {
      return { body: dto.Body ?? '' };
    }

    // Ensure the ConversationSid is mapped to a WhatsAppGroup row. If not, reconcile
    // with the author's active membership or create a new group record.
    await this.ensureGroupForConversation(dto.ConversationSid, dto.Author).catch((err) =>
      this.logger.warn(
        `[group] Failed to ensure group mapping for ${dto.ConversationSid}: ${err?.message ?? err}`,
      ),
    );

    const rawBody = (dto.Body ?? '').toString();
    const trimmedBody = rawBody.trim();

    // Look up sender display name from Sync Map (our DB)
    const senderName = await this.getSenderName(dto.Author);
    const modifiedBody = trimmedBody ? `*${senderName}*: ${rawBody}` : '';

    this.logger.log(`Group message: "${trimmedBody || '[no body]'}" (Author: ${senderName})`);

    // Persist inbound group message for context/history.
    if (trimmedBody) {
      const triggerParse = this.parseAiTrigger(trimmedBody);
      if (triggerParse.triggered && triggerParse.stripped) {
        this.logger.log(`AI trigger matched for group (trigger=${this.aiTrigger})`);
        // Debounce/merge: Twilio may send a second pre-event webhook carrying only Media.
        this.enqueueGroupAi(
          dto.ConversationSid,
          dto.Author,
          senderName,
          triggerParse.stripped,
          dto.Media,
          dto.ChatServiceSid,
        );
      }
      return { body: modifiedBody };
    }

    // Media-only pre-event (no Body). Attach to the most recent pending triggered message.
    if (dto.Media) {
      this.enqueueGroupAi(
        dto.ConversationSid,
        dto.Author,
        senderName,
        null,
        dto.Media,
        dto.ChatServiceSid,
      );
    }

    return { body: '' };
  }

  private async ensureGroupForConversation(conversationSid: string, author: string): Promise<void> {
    const existing = await this.prisma.whatsAppGroup.findUnique({
      where: { conversationSid },
      select: { id: true },
    });
    if (existing) return;

    const phone = this.normalizeWhatsAppAddress(author) ?? author;

    // If the author has exactly one ACTIVE membership, assume this ConversationSid belongs to it
    // and repair the DB mapping. This prevents "no reply" when Twilio delivers events with a
    // different ConversationSid than we have stored.
    const actives = await this.prisma.whatsAppGroupMember.findMany({
      where: { phone, status: WhatsAppGroupMemberStatus.ACTIVE },
      include: { group: true },
      take: 2,
    });

    if (actives.length === 1) {
      const m = actives[0];
      if (m.group.conversationSid !== conversationSid) {
        await this.prisma.whatsAppGroup.update({
          where: { id: m.groupId },
          data: { conversationSid },
        });
        this.logger.warn(
          `[group] Repaired conversationSid for group "${m.group.name}" → ${conversationSid}`,
        );
        return;
      }
    }

    // Fallback: create a group record for this ConversationSid so the bot can respond.
    let name = `Conversation ${conversationSid}`;
    if (this.client) {
      try {
        const conv: any = await this.client.conversations.v1
          .conversations(conversationSid)
          .fetch();
        if (conv?.friendlyName) name = String(conv.friendlyName);
      } catch {
        // ignore
      }
    }

    const joinCode = await this.generateJoinCode();
    await this.prisma.whatsAppGroup.create({
      data: {
        name,
        joinCode,
        conversationSid,
      },
    });
    this.logger.warn(`[group] Created DB group for unknown ConversationSid ${conversationSid}`);
  }

  private async triggerChatbotReplyWithMediaParts(
    conversationSid: string,
    userMessage: string,
    senderName: string,
    mediaJson: string | null,
    chatServiceSidHint: string | null,
  ): Promise<void> {
    const refs = this.parseConversationsMedia(mediaJson ?? undefined);
    let imageUrls: string[] = [];

    if (refs.length > 0) {
      const chatServiceSid = await this.getChatServiceSidForConversation(
        conversationSid,
        chatServiceSidHint ?? undefined,
      );
      const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
      const authToken = process.env.TWILIO_AUTH_TOKEN ?? '';

      if (!chatServiceSid) {
        this.logger.warn('[media] Missing ChatServiceSid for conversation; skipping media ingest');
      } else if (!accountSid || !authToken) {
        this.logger.warn('[media] TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing; skipping media ingest');
      } else {
        const stored = await this.mediaService.storeTwilioConversationsMedia(
          refs,
          chatServiceSid,
          accountSid,
          authToken,
        );
        imageUrls = stored.map((s) => s.url);
        this.logger.log(`[media] Stored ${imageUrls.length}/${refs.length} attachments for group`);
        if (imageUrls.length > 0) {
          this.logger.log(`[media] Public URLs: ${imageUrls.join(' ')}`);
        }
      }
    }

    await this.triggerChatbotReply(conversationSid, userMessage, senderName, imageUrls);
  }

  private enqueueGroupAi(
    conversationSid: string,
    author: string,
    senderName: string,
    userMessage: string | null,
    mediaJson: string | undefined,
    chatServiceSid: string | undefined,
  ) {
    const key = `${conversationSid}:${author}`;
    const now = Date.now();
    const list = this.pendingGroupAi.get(key) ?? [];

    // Drop stale entries.
    const fresh = list.filter((p) => now - p.createdAt <= this.groupAiPendingTtlMs);

    const mergeCandidate = [...fresh]
      .reverse()
      .find((p) => {
        if (p.flushed) return false;
        // Prefer merging media into a pending message with text.
        if (userMessage == null && mediaJson) return Boolean(p.userMessage) && !p.mediaJson;
        // Prefer merging text into a media-only pending entry.
        if (userMessage && !mediaJson) return !p.userMessage && Boolean(p.mediaJson);
        // Otherwise merge into the most recent non-flushed.
        return true;
      });

    if (mergeCandidate) {
      if (userMessage && !mergeCandidate.userMessage) {
        mergeCandidate.userMessage = userMessage;
      }
      if (mediaJson && !mergeCandidate.mediaJson) {
        mergeCandidate.mediaJson = mediaJson;
      }
      mergeCandidate.senderName = senderName || mergeCandidate.senderName;
      mergeCandidate.chatServiceSid = chatServiceSid || mergeCandidate.chatServiceSid;
      this.pendingGroupAi.set(key, fresh);
      return;
    }

    const id = randomBytes(6).toString('hex');
    const pending: PendingGroupAi = {
      id,
      conversationSid,
      author,
      senderName,
      userMessage: userMessage ?? null,
      mediaJson: mediaJson ?? null,
      chatServiceSid: chatServiceSid ?? null,
      createdAt: now,
      flushed: false,
      timer: setTimeout(() => this.flushGroupAi(key, id), this.groupAiDebounceMs),
    };
    fresh.push(pending);
    this.pendingGroupAi.set(key, fresh);
  }

  private flushGroupAi(key: string, id: string) {
    const list = this.pendingGroupAi.get(key) ?? [];
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return;

    const pending = list[idx];
    pending.flushed = true;
    list.splice(idx, 1);
    if (list.length === 0) this.pendingGroupAi.delete(key);
    else this.pendingGroupAi.set(key, list);

    if (!pending.userMessage) {
      return;
    }

    // Persist inbound group message only when it is an AI-triggered message.
    this.recordInboundGroupMessage(
      pending.conversationSid,
      pending.author,
      pending.userMessage,
    ).catch((err) =>
      this.logger.warn(
        `Failed to record inbound group message: ${err?.message ?? err}`,
      ),
    );

    this.triggerChatbotReplyWithMediaParts(
      pending.conversationSid,
      pending.userMessage,
      pending.senderName,
      pending.mediaJson,
      pending.chatServiceSid,
    ).catch((err) => this.logger.error('Chatbot reply failed', err));
  }

  getPublicConfig() {
    return {
      whatsappNumber: this.twilioWhatsAppNumber?.replace(/^whatsapp:/, '') ?? null,
      aiTrigger: this.aiTrigger,
      sandboxJoinPhrase: this.sandboxJoinPhrase,
    };
  }

  // ─── Group CRUD ───────────────────────────────────────────────────────

  async createGroup(dto: CreateGroupDto) {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Group name is required');
    }

    const ownerPhone = this.normalizeWhatsAppAddress(dto.ownerPhone);
    const memberPhones = this.uniquePhones(dto.memberPhones);

    if (ownerPhone && !memberPhones.includes(ownerPhone)) {
      memberPhones.unshift(ownerPhone);
    }

    if (memberPhones.length === 0) {
      throw new BadRequestException('Provide at least one member phone number');
    }

    const owner = ownerPhone
      ? await this.upsertUser(ownerPhone, dto.ownerName?.trim() || null)
      : null;

    // Create Twilio Conversation
    const conversationSid = await this.createTwilioConversation(dto.name.trim());

    const joinCode = await this.generateJoinCode();
    const group = await this.prisma.whatsAppGroup.create({
      data: {
        name: dto.name.trim(),
        joinCode,
        conversationSid,
        ownerId: owner?.id,
        members: {
          create: memberPhones.map((phone) => ({
            phone,
            userId: owner?.phone === phone ? owner.id : undefined,
            status:
              owner?.phone === phone
                ? WhatsAppGroupMemberStatus.ACTIVE
                : WhatsAppGroupMemberStatus.INVITED,
            joinedAt: owner?.phone === phone ? new Date() : undefined,
          })),
        },
      },
      include: {
        members: true,
      },
    });

    // Add owner as Conversation participant immediately
    if (ownerPhone && conversationSid) {
      await this.addConversationParticipant(conversationSid, ownerPhone);
    }

    // Send Content Template invites to other members
    const invitedMembers = group.members.filter(
      (member: WhatsAppGroupMember) =>
        member.status === WhatsAppGroupMemberStatus.INVITED,
    );
    const inviteResults = await Promise.all(
      invitedMembers.map((member: WhatsAppGroupMember) =>
        this.sendTemplateInvite(member.phone, group.name, group.joinCode),
      ),
    );

    return {
      id: group.id,
      name: group.name,
      joinCode: group.joinCode,
      conversationSid: group.conversationSid,
      members: group.members,
      invitesSent: inviteResults.filter(Boolean).length,
      outboundEnabled: Boolean(this.client),
    };
  }

  async addMembers(groupId: string, dto: AddGroupMembersDto) {
    const group = await this.prisma.whatsAppGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const phones = this.uniquePhones(dto.memberPhones);
    if (phones.length === 0) {
      throw new BadRequestException('Provide at least one phone number');
    }

    const existingMembers = await this.prisma.whatsAppGroupMember.findMany({
      where: {
        groupId,
        phone: { in: phones },
      },
    });
    const existingPhones = new Set(
      existingMembers.map((member: WhatsAppGroupMember) => member.phone),
    );
    const newPhones = phones.filter((phone) => !existingPhones.has(phone));

    if (newPhones.length === 0) {
      return { groupId, added: 0, invitesSent: 0 };
    }

    await this.prisma.whatsAppGroupMember.createMany({
      data: newPhones.map((phone) => ({
        groupId,
        phone,
        status: WhatsAppGroupMemberStatus.INVITED,
      })),
    });

    const inviteResults = await Promise.all(
      newPhones.map((phone) =>
        this.sendTemplateInvite(phone, group.name, group.joinCode),
      ),
    );

    return {
      groupId,
      added: newPhones.length,
      invitesSent: inviteResults.filter(Boolean).length,
    };
  }

  async sendGroupMessage(groupId: string, dto: SendGroupMessageDto) {
    if (!dto.body?.trim()) {
      throw new BadRequestException('Message body is required');
    }

    const group = await this.prisma.whatsAppGroup.findUnique({
      where: { id: groupId },
    });

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (!group.conversationSid) {
      throw new BadRequestException('Group has no Twilio Conversation');
    }

    const senderPhone =
      this.normalizeWhatsAppAddress(dto.senderPhone) ?? 'system';

    // Post directly to the Conversation — Twilio distributes to all participants
    await this.postConversationMessage(
      group.conversationSid,
      senderPhone,
      dto.body.trim(),
    );

    // Save to our DB for history
    const senderUser = senderPhone !== 'system'
      ? await this.prisma.user.findUnique({ where: { phone: senderPhone } })
      : null;

    await this.prisma.whatsAppGroupMessage.create({
      data: {
        groupId,
        senderUserId: senderUser?.id,
        senderPhone,
        body: dto.body.trim(),
      },
    });

    return { groupId, sent: true };
  }

  async listGroups() {
    return this.prisma.whatsAppGroup.findMany({
      include: {
        members: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getAdminOverview() {
    const [
      totalUsers,
      totalGroups,
      totalMessages,
      activeMembers,
      recentUsers,
      recentMessages,
      recentGroups,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.whatsAppGroup.count(),
      this.prisma.whatsAppGroupMessage.count(),
      this.prisma.whatsAppGroupMember.count({
        where: { status: WhatsAppGroupMemberStatus.ACTIVE },
      }),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          phone: true,
          name: true,
          createdAt: true,
        },
      }),
      this.prisma.whatsAppGroupMessage.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          body: true,
          senderPhone: true,
          createdAt: true,
          group: {
            select: {
              id: true,
              name: true,
              joinCode: true,
            },
          },
          senderUser: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.whatsAppGroup.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: {
          owner: {
            select: {
              id: true,
              name: true,
              phone: true,
            },
          },
          members: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              phone: true,
              status: true,
              joinedAt: true,
              createdAt: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                },
              },
            },
          },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              id: true,
              body: true,
              senderPhone: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              messages: true,
              members: true,
            },
          },
        },
      }),
    ]);

    return {
      metrics: {
        totalUsers,
        totalGroups,
        totalMessages,
        activeMembers,
      },
      recentUsers,
      recentMessages,
      recentGroups: recentGroups.map((group) => ({
        id: group.id,
        name: group.name,
        joinCode: group.joinCode,
        conversationSid: group.conversationSid,
        chatbotEnabled: group.chatbotEnabled,
        createdAt: group.createdAt,
        owner: group.owner,
        members: group.members,
        membersCount: group._count.members,
        activeMembersCount: group.members.filter(
          (member) => member.status === WhatsAppGroupMemberStatus.ACTIVE,
        ).length,
        messagesCount: group._count.messages,
        latestMessage: group.messages[0] ?? null,
      })),
    };
  }

  // ─── Join / Leave via Conversations API ───────────────────────────────

  private async joinConversation(
    phone: string,
    joinCode: string,
    profileName: string | null,
  ): Promise<string> {
    const hasOtherActive = await this.prisma.whatsAppGroupMember.findFirst({
      where: { phone, status: WhatsAppGroupMemberStatus.ACTIVE },
      select: { id: true, groupId: true },
    });

    const membership = await this.prisma.whatsAppGroupMember.findFirst({
      where: {
        phone,
        group: {
          is: {
            joinCode: {
              equals: joinCode,
              mode: Prisma.QueryMode.insensitive,
            },
          },
        },
      },
      include: { group: true },
    });

    // If the user wasn't explicitly invited, allow "public join" by code.
    // If the group doesn't exist yet, create it on first JOIN.
    if (!membership) {
      const existingGroup = await this.prisma.whatsAppGroup.findFirst({
        where: {
          joinCode: { equals: joinCode, mode: Prisma.QueryMode.insensitive },
        },
      });

      // First join creates the group (no curl needed).
      if (!existingGroup) {
        const owner = await this.upsertUser(phone, profileName);

        const friendlyName = this.humanizeJoinCode(joinCode);
        const conversationSid = await this.createTwilioConversation(friendlyName);

        // Creating a new group should make it the active one: pause any other active memberships.
        await this.pauseAllActiveTeams(phone);

        const group = await this.prisma.whatsAppGroup.create({
          data: {
            name: friendlyName,
            // Store canonical join codes as lowercase; lookups are case-insensitive.
            joinCode: joinCode.toLowerCase(),
            conversationSid,
            ownerId: owner.id,
            members: {
              create: [
                {
                  phone,
                  userId: owner.id,
                  status: WhatsAppGroupMemberStatus.ACTIVE,
                  joinedAt: new Date(),
                },
              ],
            },
          },
        });

        if (group.conversationSid) {
          await this.addConversationParticipant(group.conversationSid, phone);
          await this.postConversationMessage(
            group.conversationSid,
            'system',
            `${profileName || phone.replace('whatsapp:', '')} created the group`,
          );
        }

        return `Created and joined ${group.name}! Share this with friends: JOIN ${group.joinCode}. Reply LEAVE ${group.joinCode} to stop. To talk to the AI in the group, start messages with ${this.aiTrigger ?? '@vola'}.`;
      }

      if (!existingGroup.conversationSid) {
        return `Group "${existingGroup.name}" does not have an active conversation.`;
      }

      const user = await this.upsertUser(phone, profileName);
      // If the user is already active in another team, join this one as PAUSED by default.
      // They can switch with USE <code>.
      const initialStatus = hasOtherActive
        ? WhatsAppGroupMemberStatus.PAUSED
        : WhatsAppGroupMemberStatus.ACTIVE;

      await this.prisma.whatsAppGroupMember.create({
        data: {
          groupId: existingGroup.id,
          phone,
          userId: user.id,
          status: initialStatus,
          joinedAt: initialStatus === WhatsAppGroupMemberStatus.ACTIVE ? new Date() : null,
        },
      });

      if (initialStatus === WhatsAppGroupMemberStatus.ACTIVE) {
        await this.pauseAllActiveTeams(phone, existingGroup.id);
        await this.addConversationParticipant(existingGroup.conversationSid, phone);
        await this.postConversationMessage(
          existingGroup.conversationSid,
          'system',
          `${profileName || phone.replace('whatsapp:', '')} joined the group`,
        );
        return `Joined ${existingGroup.name}! Your messages will now be shared with the group. Reply LEAVE ${existingGroup.joinCode} to stop. To talk to the AI in the group, start messages with ${this.aiTrigger ?? '@vola'}.`;
      }

      return `Joined ${existingGroup.name}. You're in multiple teams — reply USE ${existingGroup.joinCode} to make this the active one.`;
    }

    if (membership.status === WhatsAppGroupMemberStatus.ACTIVE) {
      return `You are already active in ${membership.group.name}.`;
    }

    if (!membership.group.conversationSid) {
      return 'This group does not have an active conversation.';
    }

    // If they're active elsewhere, keep this join as PAUSED unless they explicitly USE it.
    if (hasOtherActive) {
      await this.prisma.whatsAppGroupMember.update({
        where: { id: membership.id },
        data: { status: WhatsAppGroupMemberStatus.PAUSED },
      });
      return `Joined ${membership.group.name}. You're in multiple teams — reply USE ${membership.group.joinCode} to make this the active one.`;
    }

    // Add as Twilio Conversation participant
    await this.pauseAllActiveTeams(phone, membership.groupId);
    await this.addConversationParticipant(
      membership.group.conversationSid,
      phone,
    );

    // Post join announcement
    await this.postConversationMessage(
      membership.group.conversationSid,
      'system',
      `${profileName || phone.replace('whatsapp:', '')} joined the group`,
    );

    // Update DB
    const user = await this.upsertUser(phone, profileName);
    await this.prisma.whatsAppGroupMember.update({
      where: { id: membership.id },
      data: {
        status: WhatsAppGroupMemberStatus.ACTIVE,
        userId: user.id,
        joinedAt: new Date(),
      },
    });

    return `Joined ${membership.group.name}! Your messages will now be shared with the group. Reply LEAVE ${joinCode} to stop. To talk to the AI in the group, start messages with ${this.aiTrigger ?? '@vola'}.`;
  }

  private async listTeams(phone: string): Promise<string> {
    const memberships = await this.prisma.whatsAppGroupMember.findMany({
      where: {
        phone,
        status: { in: [WhatsAppGroupMemberStatus.ACTIVE, WhatsAppGroupMemberStatus.PAUSED] },
      },
      include: { group: true },
      orderBy: { createdAt: 'asc' },
    });

    if (memberships.length == 0) {
      return 'You are not in any teams yet. Reply JOIN team-force (or any code) to create/join one.';
    }

    const lines = memberships.map((m) => {
      const tag = m.status === WhatsAppGroupMemberStatus.ACTIVE ? 'ACTIVE' : 'PAUSED';
      return `- ${m.group.name} (${tag}) => JOIN ${m.group.joinCode}`;
    });

    const active = memberships.find((m) => m.status === WhatsAppGroupMemberStatus.ACTIVE);
    return [
      'Your teams:',
      ...lines,
      '',
      active
        ? `Active team: ${active.group.name}.`
        : 'No active team selected.',
      'To switch: USE <team-code> (example: USE team-force)',
    ].join('\n');
  }

  private async useTeam(phone: string, joinCode: string): Promise<string> {
    const membership = await this.prisma.whatsAppGroupMember.findFirst({
      where: {
        phone,
        status: { in: [WhatsAppGroupMemberStatus.ACTIVE, WhatsAppGroupMemberStatus.PAUSED] },
        group: {
          is: {
            joinCode: { equals: joinCode, mode: Prisma.QueryMode.insensitive },
          },
        },
      },
      include: { group: true },
    });

    if (!membership) {
      return `You're not in any team with code ${joinCode}. Reply TEAMS to see your teams.`;
    }

    if (!membership.group.conversationSid) {
      return `Team "${membership.group.name}" does not have an active conversation.`;
    }

    // Activate this team. Add to the new conversation first so a Twilio error doesn't leave
    // the user paused everywhere with no reply.
    try {
      await this.addConversationParticipant(membership.group.conversationSid, phone);
    } catch (err: any) {
      this.logger.warn(
        `[teams] Failed to add participant while switching teams: ${err?.message ?? err}`,
      );
      return `Could not switch to ${membership.group.name} right now. Please try again in a minute.`;
    }

    // Pause any current ACTIVE teams and remove from their conversations.
    await this.pauseAllActiveTeams(phone, membership.groupId);

    const user = await this.upsertUser(phone, null);
    await this.prisma.whatsAppGroupMember.update({
      where: { id: membership.id },
      data: {
        status: WhatsAppGroupMemberStatus.ACTIVE,
        userId: user.id,
        joinedAt: membership.joinedAt ?? new Date(),
      },
    });

    await this.postConversationMessage(
      membership.group.conversationSid,
      'system',
      `${phone.replace('whatsapp:', '')} switched to this team`,
    ).catch((err) =>
      this.logger.warn(
        `[teams] Failed to post switch announcement: ${err?.message ?? err}`,
      ),
    );

    return `Active team set to ${membership.group.name}.`;
  }

  private async leaveConversation(
    phone: string,
    joinCode?: string,
  ): Promise<string> {
    const memberships = await this.prisma.whatsAppGroupMember.findMany({
      where: {
        phone,
        status: WhatsAppGroupMemberStatus.ACTIVE,
        ...(joinCode
          ? {
              group: {
                is: {
                  joinCode: {
                    equals: joinCode,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              },
            }
          : {}),
      },
      include: { group: true },
    });

    if (memberships.length === 0) {
      return joinCode
        ? `No active membership found for code ${joinCode}.`
        : 'You are not active in any group.';
    }

    // Remove from Twilio Conversations
    for (const membership of memberships) {
      if (membership.group.conversationSid) {
        await this.removeConversationParticipant(
          membership.group.conversationSid,
          phone,
        ).catch((err) =>
          this.logger.warn(`Failed to remove participant: ${err.message}`),
        );
      }
    }

    await this.prisma.whatsAppGroupMember.updateMany({
      where: {
        id: { in: memberships.map((m: { id: string }) => m.id) },
      },
      data: { status: WhatsAppGroupMemberStatus.LEFT },
    });

    if (memberships.length === 1) {
      return `You left ${memberships[0].group.name}.`;
    }
    return `You left ${memberships.length} groups.`;
  }

  private async pauseAllActiveTeams(phone: string, exceptGroupId?: string): Promise<void> {
    const actives = await this.prisma.whatsAppGroupMember.findMany({
      where: {
        phone,
        status: WhatsAppGroupMemberStatus.ACTIVE,
        ...(exceptGroupId ? { groupId: { not: exceptGroupId } } : {}),
      },
      include: { group: true },
    });

    for (const m of actives) {
      if (m.group.conversationSid) {
        await this.removeConversationParticipant(m.group.conversationSid, phone).catch((err) =>
          this.logger.warn(`Failed to remove participant while pausing: ${err.message}`),
        );
      }
    }

    if (actives.length > 0) {
      await this.prisma.whatsAppGroupMember.updateMany({
        where: {
          id: { in: actives.map((m) => m.id) },
        },
        data: { status: WhatsAppGroupMemberStatus.PAUSED },
      });
    }
  }

  // ─── Agent AI Chatbot ───────────────────────────────────────────────────

  private async triggerChatbotReply(
    conversationSid: string,
    userMessage: string,
    senderName: string,
    imageUrls: string[] = [],
  ): Promise<void> {
    let group = await this.prisma.whatsAppGroup.findUnique({ where: { conversationSid } });

    // This should normally already exist (created via our JOIN/CREATE flows), but Twilio sometimes
    // delivers pre-event webhooks with a ConversationSid we haven't persisted yet.
    if (!group) {
      this.logger.warn(
        `[group] No DB group for ConversationSid ${conversationSid}. Attempting auto-create/repair so the bot can reply...`,
      );
      await this.ensureGroupForConversation(conversationSid, '').catch((err) =>
        this.logger.warn(
          `[group] Auto-create/repair failed for ${conversationSid}: ${err?.message ?? err}`,
        ),
      );
      group = await this.prisma.whatsAppGroup.findUnique({ where: { conversationSid } });
    }

    if (!group) {
      this.logger.warn(
        `[group] Still no DB group for ConversationSid ${conversationSid}. Skipping reply.`,
      );
      return;
    }

    if (!group.chatbotEnabled) {
      this.logger.log(
        `[group] Chatbot disabled for group "${group.name}" (${group.joinCode}); skipping reply.`,
      );
      return;
    }

    let reply = '';
    try {
      let prompt = this.formatUserMessageWithImages(userMessage, imageUrls);
      try {
        prompt = await this.buildGroupPrompt(group.id, senderName, prompt);
      } catch (err: any) {
        this.logger.warn(
          `[group] Failed to build context prompt, falling back to raw message: ${err?.message ?? err}`,
        );
      }
      const sessionId = `group:${group.joinCode}`;
      this.logger.log(
        `[group] Calling agent gRPC: session=${sessionId} sender=${senderName} message="${userMessage}"`,
      );
      reply = await this.agentService.chat(sessionId, prompt);
      this.logger.log(`[group] Agent replied (${reply.length} chars)`);
    } catch (err) {
      this.logger.error('Agent gRPC call failed', err);
      reply = '⚠️ Our AI assistant is temporarily unavailable. Please try again shortly.';
    }

    await this.postConversationMessage(conversationSid, 'system', reply);

    // Save to message history
    await this.prisma.whatsAppGroupMessage.create({
      data: {
        groupId: group.id,
        senderPhone: 'chatbot',
        body: reply,
      },
    });
  }

  // ─── Twilio Conversations API helpers ─────────────────────────────────

  private async createTwilioConversation(
    friendlyName: string,
  ): Promise<string | null> {
    if (!this.client) {
      this.logger.warn('Twilio disabled — skipping Conversation creation');
      return null;
    }

    try {
      const conversation =
        await this.client.conversations.v1.conversations.create({
          friendlyName,
          messagingServiceSid: this.messageServiceSid || undefined,
        });
      this.logger.log(`Created Conversation ${conversation.sid}`);
      return conversation.sid;
    } catch (err) {
      this.logger.error('Failed to create Twilio Conversation', err);
      throw new InternalServerErrorException(
        'Could not create Twilio Conversation',
      );
    }
  }

  private async addConversationParticipant(
    conversationSid: string,
    phone: string,
  ): Promise<void> {
    if (!this.client || !this.twilioWhatsAppNumber) {
      this.logger.warn('Twilio disabled — skipping participant add');
      return;
    }

    try {
      await this.client.conversations.v1
        .conversations(conversationSid)
        .participants.create({
          'messagingBinding.address': phone,
          'messagingBinding.proxyAddress': this.twilioWhatsAppNumber,
        });
      this.logger.log(
        `Added participant ${phone} to Conversation ${conversationSid}`,
      );
    } catch (err: any) {
      // Participant may already exist — treat that as success (idempotent add).
      // Twilio's error codes/messages vary here, so match broadly.
      const msg = String(err?.message ?? '');
      const alreadyExists =
        err?.code === 50433 ||
        err?.status === 409 ||
        /already exists/i.test(msg) ||
        /binding for this participant/i.test(msg);
      if (alreadyExists) {
        this.logger.warn(
          `Participant ${phone} already in Conversation ${conversationSid} (skipping add)`,
        );
        return;
      }
      this.logger.error('Failed to add conversation participant', err);
      throw new InternalServerErrorException('Could not add participant');
    }
  }

  private async removeConversationParticipant(
    conversationSid: string,
    phone: string,
  ): Promise<void> {
    if (!this.client) {
      return;
    }

    const participants = await this.client.conversations.v1
      .conversations(conversationSid)
      .participants.list();

    const match = participants.find(
      (p) => (p.messagingBinding as any)?.address === phone,
    );

    if (match) {
      await this.client.conversations.v1
        .conversations(conversationSid)
        .participants(match.sid)
        .remove();
      this.logger.log(
        `Removed participant ${phone} from Conversation ${conversationSid}`,
      );
    }
  }

  private async postConversationMessage(
    conversationSid: string,
    author: string,
    body: string,
  ): Promise<void> {
    if (!this.client) {
      this.logger.warn('Twilio disabled — skipping message post');
      return;
    }

    await this.client.conversations.v1
      .conversations(conversationSid)
      .messages.create({ author, body });
  }

  private async sendTemplateInvite(
    to: string,
    groupName: string,
    joinCode: string,
  ): Promise<boolean> {
    if (!this.client) {
      return false;
    }

    // Use Content Template if available, otherwise fall back to plain text
    if (this.contentSid && this.messageServiceSid) {
      try {
        await this.client.messages.create({
          contentSid: this.contentSid,
          from: this.messageServiceSid,
          to,
        });
        return true;
      } catch (err) {
        this.logger.warn(
          `Content Template invite failed for ${to}, falling back to plain text`,
          err,
        );
      }
    }

    // Plain-text fallback
    if (this.twilioWhatsAppNumber) {
      const inviteText = [
        `You were added to "${groupName}".`,
        `Reply JOIN ${joinCode} to start receiving group messages.`,
        'After joining, any text you send here will be shared with the group.',
        `To talk to the AI, start messages with ${this.aiTrigger ?? '@vola'}.`,
      ].join(' ');

      await this.client.messages.create({
        from: this.twilioWhatsAppNumber,
        to,
        body: inviteText,
      });
      return true;
    }

    return false;
  }

  // ─── Shared helpers ───────────────────────────────────────────────────

  private async getSenderName(author: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { phone: author },
    });
    return user?.name || author.replace('whatsapp:', '');
  }

  private buildTwiml(message: string): string {
    const response = new twilio.twiml.MessagingResponse();
    response.message(message);
    return response.toString();
  }

  private buildEmptyTwiml(): string {
    return new twilio.twiml.MessagingResponse().toString();
  }

  private async upsertUser(phone: string, name: string | null) {
    return this.prisma.user.upsert({
      where: { phone },
      update: { ...(name ? { name } : {}) },
      create: { phone, ...(name ? { name } : {}) },
    });
  }

  private uniquePhones(phones: string[] | undefined): string[] {
    if (!phones) {
      return [];
    }

    const normalized = phones
      .map((phone) => this.normalizeWhatsAppAddress(phone))
      .filter((phone): phone is string => Boolean(phone));

    return Array.from(new Set(normalized));
  }

  private normalizeWhatsAppAddress(
    value: string | null | undefined,
  ): string | null {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.startsWith('whatsapp:')) {
      return trimmed;
    }

    const digitsOnly = trimmed.replace(/[^\d+]/g, '');
    if (!digitsOnly.startsWith('+')) {
      throw new BadRequestException(
        `Phone number "${value}" must be in E.164 format, for example +15551234567`,
      );
    }

    return `whatsapp:${digitsOnly}`;
  }

  private async generateJoinCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Human-friendly short code; case-insensitive comparisons everywhere.
      const joinCode = randomBytes(3).toString('hex').toUpperCase();
      const existing = await this.prisma.whatsAppGroup.findUnique({
        where: { joinCode },
      });

      if (!existing) {
        return joinCode;
      }
    }

    throw new InternalServerErrorException(
      'Could not generate a unique join code',
    );
  }

  private normalizeJoinCode(value: string): string {
    const trimmed = (value || '').trim();
    // JOIN regex already restricts to [a-z0-9-]+, but keep this robust for future commands.
    const normalized = trimmed
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!normalized) {
      throw new BadRequestException('Join code is required');
    }

    if (normalized.length > 48) {
      throw new BadRequestException('Join code is too long (max 48 chars)');
    }

    return normalized;
  }

  private humanizeJoinCode(joinCode: string): string {
    // declared-daughter -> Declared Daughter
    return joinCode
      .split('-')
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private parseAiTrigger(body: string): { triggered: boolean; stripped: string } {
    const trigger = this.aiTrigger;
    if (!trigger) {
      return { triggered: true, stripped: body.trim() };
    }

    const trimmed = (body || '').trim();
    if (!trimmed) {
      return { triggered: false, stripped: '' };
    }

    const triggerLower = trigger.toLowerCase();
    const trimmedLower = trimmed.toLowerCase();

    if (!trimmedLower.startsWith(triggerLower)) {
      return { triggered: false, stripped: trimmed };
    }

    // Drop the trigger token and common separators: "@vola:", "@vola -", "@vola," etc.
    const rest = trimmed.slice(trigger.length).replace(/^[\s,:-]+/, '').trim();
    return { triggered: true, stripped: rest };
  }

  private formatUserMessageWithImages(userMessage: string, imageUrls: string[]): string {
    if (!imageUrls || imageUrls.length === 0) return userMessage;
    const listed = imageUrls.map((u, idx) => `- [${idx + 1}] ${u}`);
    return [
      `The user attached ${imageUrls.length} image(s)/file(s).`,
      '',
      'ATTACHMENTS (use these URLs as tool arguments):',
      ...listed,
      '',
      'IMPORTANT:',
      '- If the user is asking where a place is (for example: "unde e asta?", "where is this?"), you MUST call `identify_destination` first using:',
      '  image_source = the attachment URL (pick [1] unless the user says otherwise).',
      '- If the user wants booking extraction / deal-check, you MUST call `extract_booking_info` first using:',
      '  image_path = the attachment URL (pick [1] unless the user says otherwise).',
      '- Do not guess the destination from text alone when an image is attached.',
      '',
      userMessage,
    ].join('\n');
  }

  private extractMessagingMediaItems(dto: IncomingMessageDto): { url: string; contentType: string }[] {
    const numMedia = parseInt((dto.NumMedia ?? '0') as any, 10) || 0;
    const items: { url: string; contentType: string }[] = [];
    for (let i = 0; i < Math.min(10, numMedia); i += 1) {
      const url = (dto as any)[`MediaUrl${i}`] as string | undefined;
      if (!url) continue;
      const contentType =
        ((dto as any)[`MediaContentType${i}`] as string | undefined) ??
        'application/octet-stream';
      items.push({ url, contentType });
    }
    return items;
  }

  private parseConversationsMedia(mediaJson: string | undefined): { sid: string; contentType: string }[] {
    if (!mediaJson) return [];
    try {
      const parsed = JSON.parse(mediaJson);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((m: any) => ({
          sid: String(m?.Sid ?? m?.sid ?? ''),
          contentType: String(m?.ContentType ?? m?.contentType ?? 'application/octet-stream'),
        }))
        .filter((m: any) => Boolean(m.sid));
    } catch (err) {
      this.logger.warn(`[media] Failed to parse Conversations Media JSON`);
      return [];
    }
  }

  private async getChatServiceSidForConversation(
    conversationSid: string,
    hint?: string,
  ): Promise<string | null> {
    const hinted = (hint ?? '').trim();
    if (hinted) return hinted;

    const cached = this.conversationChatServiceSidCache.get(conversationSid);
    if (cached) return cached;
    if (!this.client) return null;

    try {
      const conv: any = await this.client.conversations.v1
        .conversations(conversationSid)
        .fetch();
      const sid = String(conv?.chatServiceSid ?? conv?.chat_service_sid ?? '');
      if (sid) {
        this.conversationChatServiceSidCache.set(conversationSid, sid);
        return sid;
      }
      return null;
    } catch (err: any) {
      this.logger.warn(`[media] Failed to fetch conversation to resolve ChatServiceSid: ${err?.message ?? err}`);
      return null;
    }
  }

  private async recordDirectMessage(
    userPhone: string,
    direction: WhatsAppDirectMessageDirection,
    body: string,
    twilioMessageSid?: string,
  ): Promise<void> {
    try {
      await this.prisma.whatsAppDirectMessage.create({
        data: {
          userPhone,
          direction,
          body,
          twilioMessageSid: twilioMessageSid || null,
        },
      });
    } catch (err: any) {
      // Twilio may retry webhooks; if we already recorded this message SID, ignore.
      if (twilioMessageSid && err?.code === 'P2002') {
        return;
      }
      throw err;
    }
  }

  private async recordInboundGroupMessage(
    conversationSid: string,
    author: string,
    body: string,
  ): Promise<void> {
    const group = await this.prisma.whatsAppGroup.findUnique({
      where: { conversationSid },
      select: { id: true },
    });
    if (!group) {
      return;
    }

    const phone = this.normalizeWhatsAppAddress(author) ?? author;
    const user = phone.startsWith('whatsapp:')
      ? await this.upsertUser(phone, null)
      : null;

    await this.prisma.whatsAppGroupMessage.create({
      data: {
        groupId: group.id,
        senderUserId: user?.id,
        senderPhone: phone,
        body,
      },
    });

    if (phone.startsWith('whatsapp:')) {
      await this.prisma.whatsAppGroupMember.updateMany({
        where: {
          groupId: group.id,
          phone,
        },
        data: { lastInboundAt: new Date() },
      });
    }
  }

  private async buildGroupPrompt(
    groupId: string,
    senderName: string,
    userMessage: string,
  ): Promise<string> {
    const messages = await this.prisma.whatsAppGroupMessage.findMany({
      where: { groupId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        senderUser: { select: { name: true, phone: true } },
      },
    });

    const lines = messages
      .reverse()
      .map((m) => {
        if (m.senderPhone === 'chatbot') {
          return `Assistant: ${m.body}`;
        }
        if (m.senderPhone === 'system') {
          return `System: ${m.body}`;
        }
        const display =
          m.senderUser?.name || m.senderPhone.replace(/^whatsapp:/, '');
        const parsed = this.parseAiTrigger(m.body);
        const cleanBody = parsed.triggered ? parsed.stripped : m.body;
        return `User (${display}): ${cleanBody}`;
      });

    return [
      '__API_CTX__',
      '<<HISTORY>>',
      ...lines,
      '<<USER>>',
      // Keep this as raw user message; agent server will format it.
      userMessage,
    ].join('\n');
  }

  private async buildDirectPrompt(userPhone: string, userMessage: string): Promise<string> {
    const messages = await this.prisma.whatsAppDirectMessage.findMany({
      where: { userPhone },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const lines = messages
      .reverse()
      .map((m) => {
        const role = m.direction === WhatsAppDirectMessageDirection.INBOUND ? 'User' : 'Assistant';
        const parsed = role === 'User' ? this.parseAiTrigger(m.body) : { triggered: false, stripped: m.body };
        const cleanBody = role === 'User' && parsed.triggered ? parsed.stripped : m.body;
        return `${role}: ${cleanBody}`;
      });

    return [
      '__API_CTX__',
      '<<HISTORY>>',
      ...lines,
      '<<USER>>',
      userMessage,
    ].join('\n');
  }
}
