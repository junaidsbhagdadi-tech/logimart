#!/usr/bin/env node
/**
 * Nightly off-site database backup (owner console → "Backups").
 *   1. /root/db-backup.sh makes the pg_dump on the droplet (keeps the last 6 locally)
 *   2. that dump is uploaded PRIVATE to DO Spaces under db-backups/ (keeps the newest 14)
 *   3. the run is recorded in ops_job_runs so the console shows it and alerts if it fails / stops
 * Run from apps/api:  node scripts/offsite-backup.js      Cron: 0 21 * * * (02:30 IST)
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}

const { PrismaClient } = require('@prisma/client');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = require('@aws-sdk/client-s3');

const DIR = process.env.OPS_BACKUP_DIR || '/root/db-backups';
const KEEP = Number(process.env.OFFSITE_BACKUP_KEEP || 14);
const PREFIX = 'db-backups/';

(async () => {
  const prisma = new PrismaClient();
  const runRow = await prisma.opsJobRun.create({ data: { job: 'Off-site backup' } }).catch(() => null);
  const finish = async (ok, summary, error) => {
    const data = { finishedAt: new Date(), ok, summary: summary ?? null, error: error ? String(error).slice(0, 1000) : null };
    if (runRow) await prisma.opsJobRun.update({ where: { id: runRow.id }, data }).catch(() => undefined);
    else await prisma.opsJobRun.create({ data: { job: 'Off-site backup', ...data } }).catch(() => undefined);
    await prisma.$disconnect();
  };
  try {
    const { SPACES_ENDPOINT, SPACES_REGION, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET } = process.env;
    if (!SPACES_ENDPOINT || !SPACES_BUCKET || !SPACES_KEY || !SPACES_SECRET) throw new Error('SPACES_* not configured');

    execFileSync('bash', ['/root/db-backup.sh'], { stdio: 'inherit' });
    const latest = fs.readdirSync(DIR).filter((f) => /^logimart-.*\.dump$/.test(f))
      .map((f) => ({ f, st: fs.statSync(path.join(DIR, f)) })).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)[0];
    if (!latest || Date.now() - latest.st.mtimeMs > 3600_000) throw new Error('no fresh dump was produced');
    if (latest.st.size < 1024 * 1024) throw new Error(`dump looks too small (${latest.st.size} bytes)`);

    const s3 = new S3Client({ endpoint: SPACES_ENDPOINT, region: SPACES_REGION || 'blr1', forcePathStyle: false, credentials: { accessKeyId: SPACES_KEY, secretAccessKey: SPACES_SECRET } });
    const key = PREFIX + latest.f;
    await s3.send(new PutObjectCommand({ Bucket: SPACES_BUCKET, Key: key, Body: fs.createReadStream(path.join(DIR, latest.f)), ContentLength: latest.st.size, ACL: 'private', ContentType: 'application/octet-stream' }));

    // keep the newest KEEP copies off-site
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: SPACES_BUCKET, Prefix: PREFIX }));
    const objs = (listed.Contents || []).filter((o) => o.Key.endsWith('.dump')).sort((a, b) => +new Date(b.LastModified) - +new Date(a.LastModified));
    const old = objs.slice(KEEP);
    if (old.length) await s3.send(new DeleteObjectsCommand({ Bucket: SPACES_BUCKET, Delete: { Objects: old.map((o) => ({ Key: o.Key })) } }));

    const mb = (latest.st.size / 1048576).toFixed(1);
    console.log(`${new Date().toISOString()} off-site ok ${key} ${mb} MB (${Math.min(objs.length, KEEP)} kept, ${old.length} pruned)`);
    await finish(true, `${latest.f} · ${mb} MB · ${Math.min(objs.length, KEEP)} copies off-site`);
  } catch (e) {
    console.error(`${new Date().toISOString()} off-site FAILED: ${e?.message || e}`);
    await finish(false, null, e?.message || e);
    process.exitCode = 1;
  }
})();
