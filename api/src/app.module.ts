import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DbModule } from './db/db.module';
import { StripeModule } from './stripe/stripe.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [DbModule, WhatsAppModule, StripeModule],
  controllers: [AppController],
})
export class AppModule {}
