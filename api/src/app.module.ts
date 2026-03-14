import { Module } from '@nestjs/common';
import { WhatsAppModule } from './whatsapp.module';
import { PrismaService } from './prisma.service';

@Module({
  imports: [WhatsAppModule],
  providers: [PrismaService],
})
export class AppModule {}
