import { Injectable, Logger } from '@nestjs/common';
import * as twilio from 'twilio';
import { IncomingMessageDto } from './dto/incoming-message.dto';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  async handleIncomingMessage(dto: IncomingMessageDto): Promise<string> {
    this.logger.log(`From ${dto.From}: "${dto.Body}" (media: ${dto.NumMedia})`);

    const reply = this.resolveReply(dto);
    return this.buildTwiml(reply);
  }

  private resolveReply(dto: IncomingMessageDto): string {
    const numMedia = parseInt(dto.NumMedia, 10) || 0;

    if (numMedia > 0) {
      return '📷 Image received! We will process it shortly.';
    }

    if (dto.Body?.toLowerCase().includes('hello')) {
      return '👋 Hello! How can I help you today?';
    }

    // TODO: Forward to Rust agent via HTTP
    return '🤖 [Mock] Message received. AI agent coming soon!';
  }

  private buildTwiml(message: string): string {
    const response = new twilio.twiml.MessagingResponse();
    response.message(message);
    return response.toString();
  }
}
