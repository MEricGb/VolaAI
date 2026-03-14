import { Module } from '@nestjs/common';
import { DbModule } from './db/db.module';
import { StripeModule } from './stripe/stripe.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';

@Module({
  imports: [DbModule, WhatsAppModule, StripeModule],
})
export class AppModule {}
