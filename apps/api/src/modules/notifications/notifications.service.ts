import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface NotifyInput {
  channel: 'sms' | 'whatsapp' | 'email' | 'inapp';
  recipient: string;
  kind: 'shortage' | 'pod' | 'exception' | 'invoice' | 'delivery' | 'milestone';
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
      // SMS/email providers (MSG91 / Gupshup / SES) plug in here similarly.
    } catch (err) {
      this.logger.error(`dispatch failed (${input.channel})`, err as Error);
      return false;
    }
    this.logger.log(`[notify:${input.channel}->${input.recipient}] ${input.kind}: ${input.message}`);
    return false; // queued; no real provider configured for this channel
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
