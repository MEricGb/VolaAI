import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useBodyParser('urlencoded', { extended: true });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  Logger.log(`Listening on port ${port}`, 'Bootstrap');
}

bootstrap();
