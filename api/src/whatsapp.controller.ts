import { Controller, Post, Body, Header, HttpCode } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { IncomingMessageDto } from './dto/incoming-message.dto';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Post()
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  async handleIncoming(@Body() message: IncomingMessageDto): Promise<string> {
    return this.whatsAppService.handleIncomingMessage(message);
  }
}
