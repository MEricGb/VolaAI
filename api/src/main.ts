import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  app.useBodyParser('urlencoded', { extended: true });

  // Debug middleware to see ALL incoming requests
  app.use((req: any, res: any, next: any) => {
    if (req.url.startsWith('/whatsapp')) {
      Logger.log(`[HTTP] ${req.method} ${req.url}`, 'GlobalRequestLogger');
    }
    next();
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(`Listening on port ${port}`, 'Bootstrap');
}

bootstrap();
