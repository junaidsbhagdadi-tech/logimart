import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ShipmentsService } from './shipments.service';

/**
 * Background bulk-booking processor. The web creates a BulkBookingJob, appends its rows, then starts
 * it; this service books the rows one at a time via ShipmentsService.create() — off the HTTP request,
 * so there is no proxy timeout and the user can close the tab. Progress lives in the DB (polled by the
 * web). Only ONE job runs at a time (single-flight) to avoid overloading the box. Jobs left RUNNING by
 * a restart are re-queued on boot and resume from their remaining PENDING rows.
 */
@Injectable()
export class BulkBookingService implements OnModuleInit {
  private readonly logger = new Logger('BulkBooking');
  private readonly queue: bigint[] = [];
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly shipments: ShipmentsService,
  ) {}

  /** Resume any job interrupted mid-run by a restart. */
  async onModuleInit() {
    const stuck = await this.prisma.bulkBookingJob.findMany({
      where: { status: 'RUNNING' },
      select: { id: true },
    });
    for (const j of stuck) this.enqueue(j.id);
    if (stuck.length) this.logger.log(`Resuming ${stuck.length} interrupted bulk-booking job(s).`);
  }

  async createJob(opts: { createdById?: bigint | null; clientId?: bigint | null; isClient?: boolean }) {
    return this.prisma.bulkBookingJob.create({
      data: {
        createdById: opts.createdById ?? null,
        clientId: opts.clientId ?? null,
        isClient: !!opts.isClient,
        status: 'PENDING',
      },
      select: { id: true, status: true, total: true },
    });
  }

  /** Append a chunk of shipment rows (the web sends the file in small chunks to stay under body limits). */
  async appendRows(jobId: bigint, rows: unknown[]) {
    if (!rows.length) return { total: await this.rowCount(jobId) };
    const start = await this.rowCount(jobId);
    await this.prisma.bulkBookingJobRow.createMany({
      data: rows.map((payload, k) => ({ jobId, idx: start + k, payload: payload as any })),
    });
    await this.prisma.bulkBookingJob.update({ where: { id: jobId }, data: { total: { increment: rows.length } } });
    return { total: start + rows.length };
  }

  private rowCount(jobId: bigint) {
    return this.prisma.bulkBookingJobRow.count({ where: { jobId } });
  }

  /** Mark the job ready and start processing in the background. */
  async start(jobId: bigint) {
    await this.prisma.bulkBookingJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
    this.enqueue(jobId);
    return { ok: true };
  }

  async cancel(jobId: bigint) {
    await this.prisma.bulkBookingJob.update({ where: { id: jobId }, data: { status: 'CANCELLED', finishedAt: new Date() } });
    return { ok: true };
  }

  async progress(jobId: bigint) {
    const job = await this.prisma.bulkBookingJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    // A sample of failures (with the failing AWB) so the user can see what to fix / re-upload.
    const failures = await this.prisma.bulkBookingJobRow.findMany({
      where: { jobId, status: 'FAILED' },
      orderBy: { idx: 'asc' },
      take: 100,
      select: { idx: true, awb: true, error: true },
    });
    return { ...job, failures };
  }

  async recent(createdById?: bigint | null, isSuper = false) {
    return this.prisma.bulkBookingJob.findMany({
      where: isSuper ? {} : { createdById: createdById ?? -1n },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });
  }

  // ---- background loop (single-flight) ----

  private enqueue(jobId: bigint) {
    if (!this.queue.some((x) => x === jobId)) this.queue.push(jobId);
    void this.pump();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const jobId = this.queue[0];
        try { await this.processJob(jobId); }
        catch (e: any) { this.logger.error(`Job ${jobId} crashed: ${e?.message || e}`); }
        this.queue.shift();
      }
    } finally {
      this.running = false;
    }
  }

  private async processJob(jobId: bigint) {
    for (;;) {
      // Stop if the job was cancelled meanwhile.
      const job = await this.prisma.bulkBookingJob.findUnique({ where: { id: jobId }, select: { status: true } });
      if (!job || job.status === 'CANCELLED') return;

      const rows = await this.prisma.bulkBookingJobRow.findMany({
        where: { jobId, status: 'PENDING' },
        orderBy: { idx: 'asc' },
        take: 100,
      });
      if (!rows.length) break; // all done

      let ok = 0, bad = 0;
      for (const row of rows) {
        try {
          const sh = await this.shipments.create(row.payload as any);
          await this.prisma.bulkBookingJobRow.update({ where: { id: row.id }, data: { status: 'OK', awb: sh.awb } });
          ok++;
        } catch (e: any) {
          await this.prisma.bulkBookingJobRow.update({
            where: { id: row.id },
            data: { status: 'FAILED', error: String(e?.message || e).slice(0, 300) },
          });
          bad++;
        }
      }
      // Batch the counter update once per page to keep writes light.
      await this.prisma.bulkBookingJob.update({
        where: { id: jobId },
        data: { processed: { increment: ok + bad }, succeeded: { increment: ok }, failed: { increment: bad } },
      });
    }

    await this.prisma.bulkBookingJob.update({ where: { id: jobId }, data: { status: 'DONE', finishedAt: new Date() } });
  }
}
