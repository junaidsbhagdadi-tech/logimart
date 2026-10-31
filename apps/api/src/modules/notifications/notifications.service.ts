import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service';

export interface NotifyInput {
  channel: 'sms' | 'whatsapp' | 'email' | 'inapp';
  recipient: string;
  kind: 'shortage' | 'pod' | 'exception' | 'invoice' | 'delivery' | 'milestone' | 'account';
  message: string;
  awb?: string;
  shipmentId?: bigint;
}

/**
 * Records and dispatches notifications. The actual SMS/WhatsApp send is behind a
 * provider stub: set MSG91/WhatsApp creds in env to wire a real provider. Until
 * then notifications are persisted (status 'queued') and logged so the workflow
 * is fully exercisable.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clean an email address typed into a customer / contact field: customers' lists hold entries like
   * "<hemant.arora@x.com>", "'cs2@excelexlog.com'" or "yogesh@x.com>" — Brevo rejects those
   * ("email is not valid in to"), which is why some daily MIS mails never went. Returns '' if still invalid.
   */
  static cleanEmail(raw: string): string {
    const s = String(raw ?? '').trim();
    const inner = s.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ?? s;
    const e = inner.replace(/^[\s'"<>(\[;,:]+|[\s'"<>)\];,:.]+$/g, '').toLowerCase();
    return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(e) ? e : '';
  }

  async notify(input: NotifyInput) {
    if (input.channel === 'email') {
      const clean = NotificationsService.cleanEmail(input.recipient);
      if (!clean) {
        this.logger.warn(`Not emailing "${input.recipient}" — not a valid email address (fix it on the customer).`);
        return this.prisma.notification.create({ data: { channel: input.channel, recipient: String(input.recipient).slice(0, 190), kind: input.kind, message: input.message, awb: input.awb, shipmentId: input.shipmentId, status: 'invalid' } });
      }
      input = { ...input, recipient: clean };
    }
    const sent = await this.dispatch(input); // provider stub
    return this.prisma.notification.create({
      data: {
        channel: input.channel,
        recipient: input.recipient,
        kind: input.kind,
        message: input.message,
        awb: input.awb,
        shipmentId: input.shipmentId,
        status: sent ? 'sent' : 'queued',
      },
    });
  }

  /** Provider hook. Returns true if actually sent. */
  private async dispatch(input: NotifyInput): Promise<boolean> {
    try {
      if (input.channel === 'whatsapp') return await this.sendWhatsApp(input);
      if (input.channel === 'email') return await this.sendEmail(input);
      // SMS providers (MSG91 / Gupshup) plug in here similarly.
    } catch (err) {
      this.logger.error(`dispatch failed (${input.channel})`, err as Error);
      return false;
    }
    this.logger.log(`[notify:${input.channel}->${input.recipient}] ${input.kind}: ${input.message}`);
    return false; // queued; no real provider configured for this channel
  }

  // Lazily-built SMTP transport. Configured entirely from env so no secret lives in code:
  //   SMTP_HOST (required to enable) · SMTP_PORT (default 587) · SMTP_SECURE (default true only on 465)
  //   SMTP_USER (default: the SMTP_FROM address) · SMTP_PASS · SMTP_FROM (e.g. "Logimart <noreply@logimart.co.in>")
  // With SMTP_HOST unset, email stays queued-only (unchanged behaviour) — safe to deploy before creds land.
  private mailer: nodemailer.Transporter | null = null;
  private mailerInit = false;
  private getMailer(): nodemailer.Transporter | null {
    if (this.mailerInit) return this.mailer;
    this.mailerInit = true;
    const host = process.env.SMTP_HOST;
    if (!host) return (this.mailer = null);
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = (process.env.SMTP_SECURE ?? '').trim()
      ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
      : port === 465;
    const fromAddr = (process.env.SMTP_FROM || '').match(/<([^>]+)>/)?.[1] || process.env.SMTP_FROM || '';
    const user = process.env.SMTP_USER || fromAddr || undefined;
    const pass = process.env.SMTP_PASS || undefined;
    this.mailer = nodemailer.createTransport({ host, port, secure, auth: user && pass ? { user, pass } : undefined });
    this.logger.log(`SMTP transport ready → ${host}:${port} (secure=${secure})`);
    return this.mailer;
  }

  private emailSubject(kind: NotifyInput['kind']): string {
    const map: Record<NotifyInput['kind'], string> = {
      invoice: 'Invoice from ExcelEx Group', shortage: 'Shortage notice — ExcelEx Group', pod: 'Proof of delivery — ExcelEx Group',
      exception: 'Shipment exception — ExcelEx Group', delivery: 'Delivery update — ExcelEx Group', milestone: 'Shipment update — ExcelEx Group',
      account: 'ExcelEx Group report',
    };
    return map[kind] ?? 'ExcelEx Group notification';
  }

  /** Sender identity, parsed from SMTP_FROM ("Name <email>" or "email"). */
  private emailSender(): { email: string; name: string } {
    const raw = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@logimart.co.in';
    const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (m) return { name: (m[1] || 'ExcelEx Group').replace(/^"|"$/g, ''), email: m[2].trim() };
    return { name: 'ExcelEx Group', email: raw.trim() };
  }

  /** Email — Brevo HTTPS API first (works where outbound SMTP ports are blocked, e.g. DO droplets),
   *  else SMTP (nodemailer). Returns true only when the provider actually accepted the message. */
  private async sendEmail(input: NotifyInput): Promise<boolean> {
    const subject = input.awb ? `${this.emailSubject(input.kind)} · AWB ${input.awb}` : this.emailSubject(input.kind);
    if (process.env.BREVO_API_KEY) return this.sendEmailViaBrevo(input, subject);
    const t = this.getMailer();
    if (!t) { this.logger.log(`[email->${input.recipient}] (no email provider configured) ${input.message}`); return false; }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@logimart.co.in';
    const info = await t.sendMail({ from, to: input.recipient, subject, text: input.message });
    this.logger.log(`[email->${input.recipient}] sent via SMTP id=${info.messageId}`);
    return true;
  }

  /** Send one email through Brevo's transactional API (HTTPS, port 443). Set BREVO_API_KEY in env. */
  private async sendEmailViaBrevo(input: NotifyInput, subject: string): Promise<boolean> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY as string, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: this.emailSender(), to: [{ email: input.recipient }], subject, textContent: input.message }),
    });
    if (!res.ok) { this.logger.warn(`Brevo send failed: ${res.status} ${await res.text()}`); return false; }
    const j: any = await res.json().catch(() => ({}));
    this.logger.log(`[email->${input.recipient}] sent via Brevo id=${j.messageId ?? 'ok'}`);
    return true;
  }

  /**
   * A full email (several To / CC, optional HTML and attachments) — for reports such as the customer MIS.
   * Same providers as notify(): Brevo API if BREVO_API_KEY, else SMTP. Logged as one notification per To.
   */
  async sendMail(m: { to: string[]; cc?: string[]; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }): Promise<boolean> {
    const to = [...new Set(m.to.map((x) => x.trim()).filter(Boolean))];
    const cc = [...new Set((m.cc ?? []).map((x) => x.trim()).filter((x) => x && !to.includes(x)))];
    if (!to.length) return false;
    let ok = false;
    try {
      if (process.env.BREVO_API_KEY) {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': process.env.BREVO_API_KEY as string, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: this.emailSender(), to: to.map((email) => ({ email })), ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}),
            subject: m.subject, textContent: m.text, ...(m.html ? { htmlContent: m.html } : {}),
            ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') })) } : {}),
          }),
        });
        ok = res.ok;
        if (!ok) this.logger.warn(`Brevo send failed: ${res.status} ${await res.text()}`);
      } else {
        const t = this.getMailer();
        if (t) {
          const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@logimart.co.in';
          await t.sendMail({ from, to, cc: cc.length ? cc : undefined, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
          ok = true;
        }
      }
    } catch (err) {
      this.logger.error(`sendMail failed (${m.subject})`, err as Error);
    }
    for (const r of to) {
      await this.prisma.notification.create({ data: { channel: 'email', recipient: r, kind: 'account', message: `${m.subject}${cc.length ? ` (cc ${cc.join(', ')})` : ''}`, status: ok ? 'sent' : 'queued' } }).catch(() => {});
    }
    return ok;
  }

  /**
   * WhatsApp via Meta Cloud API. Set WHATSAPP_TOKEN + WHATSAPP_PHONE_ID in env.
   * Sends a session text message (works within the 24h window; outside it Meta
   * requires a pre-approved template — swap to a template payload then).
   */
  private async sendWhatsApp(input: NotifyInput): Promise<boolean> {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      this.logger.log(`[whatsapp->${input.recipient}] (no creds) ${input.message}`);
      return false;
    }
    const to = input.recipient.replace(/[^\d]/g, '');
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: input.message },
      }),
    });
    if (!res.ok) {
      this.logger.warn(`WhatsApp send failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  }

  list(kind?: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }
}
