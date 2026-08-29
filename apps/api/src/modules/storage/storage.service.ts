import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * Object storage for POD / signature / stamp images.
 *
 * Transparent offload: clients keep sending base64 `data:` URIs exactly as before.
 * On write, `store()` uploads the bytes to DigitalOcean Spaces (S3-compatible, PRIVATE
 * ACL) and returns the object KEY to persist instead of the fat blob. On read,
 * `resolve()` turns a key into a short-lived presigned GET URL the browser can load.
 *
 * If Spaces env vars are absent (local dev, or the partner's on-box Postgres deploy),
 * both methods degrade to pass-through — the data URI is stored inline as it always was.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger('Storage');
  private client: S3Client | null = null;
  private readonly bucket = process.env.SPACES_BUCKET || '';
  private readonly endpoint = process.env.SPACES_ENDPOINT || ''; // e.g. https://blr1.digitaloceanspaces.com
  private readonly region = process.env.SPACES_REGION || 'blr1';

  private get enabled(): boolean {
    return !!(this.bucket && this.endpoint && process.env.SPACES_KEY && process.env.SPACES_SECRET);
  }

  private s3(): S3Client {
    if (!this.client) {
      this.client = new S3Client({
        region: this.region,
        endpoint: this.endpoint,
        forcePathStyle: false,
        credentials: { accessKeyId: process.env.SPACES_KEY!, secretAccessKey: process.env.SPACES_SECRET! },
      });
    }
    return this.client;
  }

  /**
   * Persist an image value. A base64 `data:` URI is offloaded to Spaces and its object
   * key returned; anything else (already a key or an http URL, or null) is returned
   * unchanged so the call is idempotent and safe on re-saves.
   */
  async store(value: string | null | undefined, prefix = 'pod'): Promise<string | null | undefined> {
    if (!value || !value.startsWith('data:') || !this.enabled) return value;
    const m = /^data:([^;]+);base64,(.*)$/s.exec(value);
    if (!m) return value; // not a base64 data URI — leave it be
    const [, mime, b64] = m;
    const ext = (mime.split('/')[1] || 'bin').replace('+xml', '').replace('jpeg', 'jpg');
    const d = new Date();
    const key = `${prefix}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${ext}`;
    try {
      await this.s3().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: Buffer.from(b64, 'base64'), ContentType: mime, ACL: 'private' }));
      return key;
    } catch (e: any) {
      this.log.error(`Spaces upload failed (${key}): ${e?.message} — falling back to inline storage.`);
      return value; // never lose the POD: fall back to storing the data URI inline
    }
  }

  /** Turn a stored value into something a browser can load. Keys → short-lived presigned URL. */
  async resolve(value: string | null | undefined): Promise<string | null> {
    if (!value) return null;
    if (value.startsWith('data:') || value.startsWith('http://') || value.startsWith('https://') || !this.enabled) return value;
    try {
      return await getSignedUrl(this.s3(), new GetObjectCommand({ Bucket: this.bucket, Key: value }), { expiresIn: 3600 });
    } catch (e: any) {
      this.log.warn(`Spaces presign failed (${value}): ${e?.message}`);
      return null;
    }
  }
}
