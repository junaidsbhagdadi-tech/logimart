import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const MailComposer = require('nodemailer/lib/mail-composer');
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

  /** Amazon SES (HTTPS API — DigitalOcean blocks outbound SMTP ports) is used first once its keys are set:
   *  SES_ACCESS_KEY_ID · SES_SECRET_ACCESS_KEY · SES_REGION (default ap-south-1, Mumbai). MAIL_PROVIDER=brevo
   *  forces Brevo back. The From address is SMTP_FROM and must be on a domain verified in SES. */
  static sesEnabled() {
    return !!(process.env.SES_ACCESS_KEY_ID && process.env.SES_SECRET_ACCESS_KEY) && String(process.env.MAIL_PROVIDER || '').toLowerCase() !== 'brevo';
  }
  private ses: SESv2Client | null = null;
  private async sendViaSes(m: { to: string[]; cc?: string[]; bcc?: string[]; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[] }) {
    this.ses ??= new SESv2Client({ region: process.env.SES_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.SES_ACCESS_KEY_ID!, secretAccessKey: process.env.SES_SECRET_ACCESS_KEY! } });
    const s = this.emailSender();
    // A raw MIME message carries HTML + attachments (the MIS Excel) the same way SMTP would.
    const raw: Buffer = await new MailComposer({
      from: `"${s.name}" <${s.email}>`, to: m.to, cc: m.cc?.length ? m.cc : undefined, subject: m.subject, text: m.text, html: m.html,
      attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    }).compile().build();
    const r = await this.ses.send(new SendEmailCommand({
      FromEmailAddress: s.email,
      Destination: { ToAddresses: m.to, ...(m.cc?.length ? { CcAddresses: m.cc } : {}), ...(m.bcc?.length ? { BccAddresses: m.bcc } : {}) },
      Content: { Raw: { Data: raw } },
      ...(process.env.SES_CONFIG_SET ? { ConfigurationSetName: process.env.SES_CONFIG_SET } : {}),
    }));
    this.logger.log(`[email->${m.to.join(', ')}] sent via SES id=${r.MessageId}`);
    return true;
  }

  /**
   * One message to many people, all in BCC (bulk customer notice). Sent in batches of 45 addresses (SES caps a
   * message at 50 recipients) and paced under the SES per-second rate. The visible To is
   * "undisclosed-recipients" so no customer sees another's address.
   */
  async sendBulkBcc(m: { subject: string; text: string; html?: string; bcc: string[]; attachments?: { filename: string; content: Buffer; contentType?: string }[] }) {
    const base = [...new Set(m.bcc.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const list = [...this.copyBcc(m.subject, m.text, base), ...base];
    const s = this.emailSender();
    let sent = 0, failed = 0, batches = 0;
    for (let i = 0; i < list.length; i += 45) {
      const chunk = list.slice(i, i + 45);
      batches++;
      try {
        if (NotificationsService.sesEnabled()) {
          this.ses ??= new SESv2Client({ region: process.env.SES_REGION || 'ap-south-1', credentials: { accessKeyId: process.env.SES_ACCESS_KEY_ID!, secretAccessKey: process.env.SES_SECRET_ACCESS_KEY! } });
          const raw: Buffer = await new MailComposer({ from: `"${s.name}" <${s.email}>`, to: 'undisclosed-recipients:;', subject: m.subject, text: m.text, html: m.html, attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })) }).compile().build();
          await this.ses.send(new SendEmailCommand({ FromEmailAddress: s.email, Destination: { BccAddresses: chunk }, Content: { Raw: { Data: raw } }, ...(process.env.SES_CONFIG_SET ? { ConfigurationSetName: process.env.SES_CONFIG_SET } : {}) }));
        } else if (process.env.BREVO_API_KEY) {
          const res = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST', headers: { 'api-key': process.env.BREVO_API_KEY as string, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ sender: s, to: [{ email: s.email }], bcc: chunk.map((email) => ({ email })), subject: m.subject, textContent: m.text, ...(m.html ? { htmlContent: m.html } : {}), ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.filename, content: a.content.toString('base64') })) } : {}) }),
          });
          if (!res.ok) throw new Error(`Brevo ${res.status}`);
        } else {
          const t = this.getMailer();
          if (!t) throw new Error('no mail provider configured');
          await t.sendMail({ from: process.env.SMTP_FROM || 'noreply@logimart.co.in', to: s.email, bcc: chunk, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
        }
        sent += chunk.length;
      } catch (err) {
        failed += chunk.length;
        this.logger.error(`bulk mail batch ${batches} failed (${m.subject})`, err as Error);
      }
      if (i + 45 < list.length) await new Promise((r) => setTimeout(r, Math.ceil(chunk.length / 10) * 1000)); // ≤ ~10 recipients/s
    }
    this.logger.log(`[bulk email] "${m.subject}" → ${sent} sent, ${failed} failed in ${batches} batch(es)`);
    return { sent, failed, batches };
  }

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
    // The log keeps the message text — never a password (welcome / reset mails carry a temporary one).
    const logged = (m: string) => String(m ?? '').replace(/(password:\s*)\S+/gi, '$1••••••');
    if (input.channel === 'email') {
      const clean = NotificationsService.cleanEmail(input.recipient);
      if (!clean) {
        this.logger.warn(`Not emailing "${input.recipient}" — not a valid email address (fix it on the customer).`);
        return this.prisma.notification.create({ data: { channel: input.channel, recipient: String(input.recipient).slice(0, 190), kind: input.kind, message: logged(input.message), awb: input.awb, shipmentId: input.shipmentId, status: 'invalid' } });
      }
      input = { ...input, recipient: clean };
    }
    const sent = await this.dispatch(input); // provider stub
    return this.prisma.notification.create({
      data: {
        channel: input.channel,
        recipient: input.recipient,
        kind: input.kind,
        message: logged(input.message),
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

  /**
   * Office copy: every e-mail we send also goes to MAIL_COPY_BCC (default rahul@logimart.co.in) in BCC —
   * customers never see it. NOT copied: mails carrying a password / sign-in code, and Tech Console alerts.
   * MAIL_COPY_BCC=off disables; several addresses comma-separated.
   */
  private copyBcc(subject: string, text: string, already: string[] = []): string[] {
    const cfg = (process.env.MAIL_COPY_BCC ?? 'rahul@logimart.co.in').trim();
    if (!cfg || /^(off|none|false)$/i.test(cfg)) return [];
    if (/password|sign-in code|\botp\b|verification code/i.test(`${subject}\n${text}`) || /^\[ERP alert\]/i.test(subject)) return [];
    const have = new Set(already.map((x) => x.trim().toLowerCase()));
    return cfg.split(/[,;\s]+/).map((x) => NotificationsService.cleanEmail(x)).filter((x) => x && !have.has(x));
  }

  /** Sender identity, parsed from SMTP_FROM ("Name <email>" or "email"). */
  private emailSender(): { email: string; name: string } {
    const raw = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@logimart.co.in';
    const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (m) return { name: (m[1] || 'ExcelEx').replace(/^"|"$/g, ''), email: m[2].trim() };
    return { name: 'ExcelEx', email: raw.trim() };
  }

  /** Email — Brevo HTTPS API first (works where outbound SMTP ports are blocked, e.g. DO droplets),
   *  else SMTP (nodemailer). Returns true only when the provider actually accepted the message. */
  private async sendEmail(input: NotifyInput): Promise<boolean> {
    const subject = input.awb ? `${this.emailSubject(input.kind)} · AWB ${input.awb}` : this.emailSubject(input.kind);
    const bcc = this.copyBcc(subject, input.message, [input.recipient]);
    if (NotificationsService.sesEnabled()) return this.sendViaSes({ to: [input.recipient], bcc, subject, text: input.message });
    if (process.env.BREVO_API_KEY) return this.sendEmailViaBrevo(input, subject, bcc);
    const t = this.getMailer();
    if (!t) { this.logger.log(`[email->${input.recipient}] (no email provider configured) ${input.message}`); return false; }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@logimart.co.in';
    const info = await t.sendMail({ from, to: input.recipient, bcc: bcc.length ? bcc : undefined, subject, text: input.message });
    this.logger.log(`[email->${input.recipient}] sent via SMTP id=${info.messageId}`);
    return true;
  }

  /** Send one email through Brevo's transactional API (HTTPS, port 443). Set BREVO_API_KEY in env. */
  private async sendEmailViaBrevo(input: NotifyInput, subject: string, bcc: string[] = []): Promise<boolean> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY as string, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: this.emailSender(), to: [{ email: input.recipient }], ...(bcc.length ? { bcc: bcc.map((email) => ({ email })) } : {}), subject, textContent: input.message }),
    });
    if (!res.ok) { this.logger.warn(`Brevo send failed: ${res.status} ${await res.text()}`); return false; }
    const j: any = await res.json().catch(() => ({}));
    this.logger.log(`[email->${input.recipient}] sent via Brevo id=${j.messageId ?? 'ok'}`);
    return true;
  }

  /**
   * A full email (several To / CC, optional HTML and attachments) — for reports such as the customer MIS.
   * Same providers as notify(): Amazon SES if configured, else Brevo API if BREVO_API_KEY, else SMTP. Logged as one notification per To.
   */
  async sendMail(m: { to: string[]; cc?: string[]; subject: string; text: string; html?: string; attachments?: { filename: string; content: Buffer; contentType?: string }[]; officeCopy?: boolean }): Promise<boolean> {
    const to = [...new Set(m.to.map((x) => x.trim()).filter(Boolean))];
    const cc = [...new Set((m.cc ?? []).map((x) => x.trim()).filter((x) => x && !to.includes(x)))];
    if (!to.length) return false;
    const bcc = m.officeCopy === false ? [] : this.copyBcc(m.subject, m.text, [...to, ...cc]);
    let ok = false;
    try {
      if (NotificationsService.sesEnabled()) {
        ok = await this.sendViaSes({ to, cc, bcc, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
      } else if (process.env.BREVO_API_KEY) {
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': process.env.BREVO_API_KEY as string, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            sender: this.emailSender(), to: to.map((email) => ({ email })), ...(cc.length ? { cc: cc.map((email) => ({ email })) } : {}), ...(bcc.length ? { bcc: bcc.map((email) => ({ email })) } : {}),
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
          await t.sendMail({ from, to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, subject: m.subject, text: m.text, html: m.html, attachments: m.attachments });
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
