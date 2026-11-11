import 'reflect-metadata';
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { WorkforceController } from './workforce';
@Module({ controllers: [WorkforceController] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.APP_ORIGIN ?? 'http://localhost:4200' });
  await app.listen(3000, '127.0.0.1');
}
void bootstrap();
