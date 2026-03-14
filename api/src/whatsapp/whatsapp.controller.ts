import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { AddGroupMembersDto } from './dto/add-group-members.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { IncomingMessageDto } from './dto/incoming-message.dto';
import { SendGroupMessageDto } from './dto/send-group-message.dto';
import { ConversationPreEventDto } from './dto/conversation-pre-event.dto';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  /** Twilio Messaging webhook — handles JOIN / LEAVE commands */
  @Post()
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleIncoming(@Body() message: IncomingMessageDto): Promise<string> {
    return this.whatsAppService.handleIncomingMessage(message);
  }

  /**
   * Twilio Conversations pre-event webhook (onMessageAdd).
   * Prefixes sender name to messages and triggers chatbot.
   */
  @Post('conversations/pre-event')
  @HttpCode(200)
  async handleConversationPreEvent(@Body() dto: ConversationPreEventDto) {
    return this.whatsAppService.handleConversationPreEvent(dto);
  }

  @Get('groups')
  async listGroups() {
    return this.whatsAppService.listGroups();
  }

  @Post('groups')
  async createGroup(@Body() dto: CreateGroupDto) {
    return this.whatsAppService.createGroup(dto);
  }

  @Post('groups/:groupId/members')
  async addMembers(
    @Param('groupId') groupId: string,
    @Body() dto: AddGroupMembersDto,
  ) {
    return this.whatsAppService.addMembers(groupId, dto);
  }

  @Post('groups/:groupId/messages')
  async sendGroupMessage(
    @Param('groupId') groupId: string,
    @Body() dto: SendGroupMessageDto,
  ) {
    return this.whatsAppService.sendGroupMessage(groupId, dto);
  }
}
