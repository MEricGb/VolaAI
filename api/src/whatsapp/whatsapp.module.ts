import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { MediaModule } from '../media/media.module';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [AgentModule, MediaModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService],
})
export class WhatsAppModule {}
