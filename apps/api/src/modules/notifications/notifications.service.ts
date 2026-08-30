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

  async notify(input: NotifyInput) {
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
      invoice: 'Invoice from Logimart', shortage: 'Shortage notice — Logimart', pod: 'Proof of delivery — Logimart',
      exception: 'Shipment exception — Logimart', delivery: 'Delivery update — Logimart', milestone: 'Shipment update — Logimart',
      account: 'Logimart report',
    };
    return map[kind] ?? 'Logimart notification';
  }

  /** Email via SMTP (nodemailer). Returns true only when actually accepted by the server. */
  private async sendEmail(input: NotifyInput): Promise<boolean> {
    const t = this.getMailer();
    if (!t) { this.logger.log(`[email->${input.recipient}] (no SMTP configured) ${input.message}`); return false; }
    const from = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@logimart.co.in';
    const subject = input.awb ? `${this.emailSubject(input.kind)} · AWB ${input.awb}` : this.emailSubject(input.kind);
    const info = await t.sendMail({ from, to: input.recipient, subject, text: input.message });
    this.logger.log(`[email->${input.recipient}] sent id=${info.messageId}`);
    return true;
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
