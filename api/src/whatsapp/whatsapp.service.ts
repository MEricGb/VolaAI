import { Injectable, Logger } from '@nestjs/common';
import * as twilio from 'twilio';
import { AgentService } from '../agent/agent.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private readonly agentService: AgentService) {}

  async handleIncomingMessage(dto: IncomingMessageDto): Promise<string> {
    this.logger.log(`From ${dto.From}: "${dto.Body}" (media: ${dto.NumMedia})`);

    const reply = await this.resolveReply(dto);
    return this.buildTwiml(reply);
  }

  private async resolveReply(dto: IncomingMessageDto): Promise<string> {
    const numMedia = parseInt(dto.NumMedia, 10) || 0;

    if (numMedia > 0) {
      return '📷 Image received! We will process it shortly.';
    }

    try {
      // Use the sender's WhatsApp number as the session ID so the agent
      // can maintain per-user conversation state.
      return await this.agentService.chat(dto.From, dto.Body ?? '');
    } catch (err) {
      this.logger.error('Agent gRPC call failed', err);
      return '⚠️ Our AI assistant is temporarily unavailable. Please try again shortly.';
    }
  }

  private buildTwiml(message: string): string {
    const response = new twilio.twiml.MessagingResponse();
    response.message(message);
    return response.toString();
  }
}
