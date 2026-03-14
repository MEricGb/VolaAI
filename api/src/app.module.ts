import { Module } from '@nestjs/common';
import { WhatsAppModule } from './whatsapp.module';

@Module({
  imports: [WhatsAppModule],
})
export class AppModule {}
