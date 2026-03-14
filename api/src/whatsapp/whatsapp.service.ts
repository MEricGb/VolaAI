import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { WhatsAppGroupMember, WhatsAppGroupMemberStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import twilio = require('twilio');
import { PrismaService } from '../db/prisma.service';
import { AddGroupMembersDto } from './dto/add-group-members.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { ConversationPreEventDto } from './dto/conversation-pre-event.dto';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly client: twilio.Twilio | null;
  private readonly twilioWhatsAppNumber: string | null;
  private readonly messageServiceSid: string | null;
  private readonly contentSid: string | null;

  constructor(private readonly prisma: PrismaService) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    this.twilioWhatsAppNumber = this.normalizeWhatsAppAddress(
      process.env.TWILIO_WHATSAPP_NUMBER,
    );
    this.messageServiceSid = process.env.TWILIO_MESSAGE_SERVICE_SID ?? null;
    this.contentSid = process.env.TWILIO_CONTENT_SID ?? null;

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

    // Handle JOIN <code>
    const joinMatch = body.match(/^join\s+([a-z0-9-]+)$/i);
    if (joinMatch) {
      const reply = await this.joinConversation(from, joinMatch[1].toUpperCase(), profileName);
      return this.buildTwiml(reply);
    }

    // Handle LEAVE <code>
    const leaveMatch = body.match(/^leave(?:\s+([a-z0-9-]+))?$/i);
    if (leaveMatch) {
      const reply = await this.leaveConversation(from, leaveMatch[1]?.toUpperCase());
      return this.buildTwiml(reply);
    }

    return this.buildTwiml(
      'Send JOIN <code> to join a group, or LEAVE <code> to leave one.',
    );
  }

  // ─── Conversations pre-event webhook (onMessageAdd) ───────────────────

  async handleConversationPreEvent(dto: ConversationPreEventDto) {
    if (dto.EventType !== 'onMessageAdd') {
      return { body: dto.Body };
    }

    // Skip system messages
    if (dto.Author === 'system') {
      return { body: dto.Body };
    }

    // Look up sender display name from Sync Map (our DB)
    const senderName = await this.getSenderName(dto.Author);
    const modifiedBody = `*${senderName}*: ${dto.Body}`;

    // Trigger chatbot response asynchronously (don't block the webhook)
    this.triggerChatbotReply(dto.ConversationSid, dto.Body, senderName).catch(
      (err) => this.logger.error('Chatbot reply failed', err),
    );

    return { body: modifiedBody };
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
        deliveredCount: 0, // Twilio handles delivery
        skippedCount: 0,
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

  // ─── Join / Leave via Conversations API ───────────────────────────────

  private async joinConversation(
    phone: string,
    joinCode: string,
    profileName: string | null,
  ): Promise<string> {
    const membership = await this.prisma.whatsAppGroupMember.findFirst({
      where: { phone, group: { joinCode } },
      include: { group: true },
    });

    if (!membership) {
      return `No invite found for code ${joinCode}.`;
    }

    if (membership.status === WhatsAppGroupMemberStatus.ACTIVE) {
      return `You are already active in ${membership.group.name}.`;
    }

    if (!membership.group.conversationSid) {
      return 'This group does not have an active conversation.';
    }

    // Add as Twilio Conversation participant
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

    return `Joined ${membership.group.name}! Your messages will now be shared with the group. Reply LEAVE ${joinCode} to stop.`;
  }

  private async leaveConversation(
    phone: string,
    joinCode?: string,
  ): Promise<string> {
    const where = {
      phone,
      status: WhatsAppGroupMemberStatus.ACTIVE,
      ...(joinCode ? { group: { joinCode } } : {}),
    };

    const memberships = await this.prisma.whatsAppGroupMember.findMany({
      where,
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

  // ─── Mock Chatbot ─────────────────────────────────────────────────────

  private async triggerChatbotReply(
    conversationSid: string,
    userMessage: string,
    senderName: string,
  ): Promise<void> {
    const group = await this.prisma.whatsAppGroup.findUnique({
      where: { conversationSid },
    });

    if (!group?.chatbotEnabled) {
      return;
    }

    const reply = this.generateMockReply(userMessage, senderName);

    await this.postConversationMessage(conversationSid, 'system', reply);

    // Save to message history
    await this.prisma.whatsAppGroupMessage.create({
      data: {
        groupId: group.id,
        senderPhone: 'chatbot',
        body: reply,
        deliveredCount: 0,
        skippedCount: 0,
      },
    });
  }

  /**
   * Mock LLM response — replace with real LLM service call later.
   */
  private generateMockReply(userMessage: string, senderName: string): string {
    const lower = userMessage.toLowerCase();

    if (lower.includes('hello') || lower.includes('hi') || lower.includes('hey')) {
      return `🤖 Hey ${senderName}! How can I help the group today?`;
    }

    if (lower.includes('help')) {
      return [
        '🤖 Here are some things I can help with:',
        '• Answer questions about the group',
        '• Provide information and summaries',
        '• Help coordinate group activities',
        '',
        '_This is a mock response. Real AI coming soon!_',
      ].join('\n');
    }

    if (lower.includes('?')) {
      return `🤖 Great question, ${senderName}! I'm still learning, but I'll be able to help with that soon. _[Mock response]_`;
    }

    return `🤖 Thanks for your message, ${senderName}. I'm a mock chatbot for now — real AI responses coming soon! _[Mock response]_`;
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
      // Participant may already exist — that's fine
      if (err?.code === 50433) {
        this.logger.warn(`Participant ${phone} already in conversation`);
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
}
