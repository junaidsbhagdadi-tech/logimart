import 'reflect-metadata';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { OpsExceptionFilter } from './common/ops-exception.filter';
import { opsHttp, opsRecord } from './common/ops-hooks';

// A crash that escapes everything: record it for the owner console, then exit so pm2 restarts cleanly.
process.on('uncaughtException', (e: any) => {
  Logger.error(`Uncaught exception: ${e?.stack || e}`, 'Process');
  opsRecord({ kind: 'error', level: 'error', source: 'process', message: `CRASH — uncaught exception: ${String(e?.message || e).slice(0, 400)}`, detail: { stack: String(e?.stack || '').slice(0, 4000) }, fingerprint: `crash:${String(e?.message || e).slice(0, 80)}` });
  setTimeout(() => process.exit(1), 1500);
});

// BigInt is not JSON-serializable by default — emit as string.
(BigInt.prototype as any).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const { json, urlencoded } = await import('express');
  // Owner console: count every request (status + time) into the per-minute traffic row.
  app.use((req: any, res: any, next: any) => {
    const t = Date.now();
    res.on('finish', () => opsHttp(req.method, req.originalUrl || req.url || '', res.statusCode, Date.now() - t));
    next();
  });
  app.use(json({ limit: '60mb' }));           // large bulk uploads (21k-row pincode mapping etc.)
  app.use(urlencoded({ extended: true, limit: '60mb' }));
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new OpsExceptionFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableCors();
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  Logger.log(`Logimart ERP API listening on :${port}`, 'Bootstrap');
}
bootstrap();
