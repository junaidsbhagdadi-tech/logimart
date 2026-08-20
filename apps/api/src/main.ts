import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

// BigInt is not JSON-serializable by default — emit as string.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const { json, urlencoded } = await import('express');
  app.use(json({ limit: '60mb' }));           // large bulk uploads (21k-row pincode mapping etc.)
  app.use(urlencoded({ extended: true, limit: '60mb' }));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Logimart ERP API listening on :${port}`, 'Bootstrap');
}
bootstrap();
