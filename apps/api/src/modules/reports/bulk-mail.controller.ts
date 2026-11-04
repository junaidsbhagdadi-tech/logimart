import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RolesGuard } from '../../common/rbac/roles.guard';
import { Feature, Roles } from '../../common/rbac/roles.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Attachments: up to 5 files, 7 MB in all (SES caps a whole message at 10 MB after encoding); no programs. */
const BLOCKED = /\.(exe|bat|cmd|com|scr|vbs|vbe|js|jse|wsf|msi|ps1|jar|apk|dll|sh|lnk|hta)$/i;
function attachmentsOf(list: any): { filename: string; content: Buffer; contentType?: string }[] {
  const arr = Array.isArray(list) ? list : [];
  if (arr.length > 5) throw new BadRequestException('Attach at most 5 files.');
  let total = 0;
  return arr.map((a: any) => {
    const filename = String(a?.name ?? '').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 120);
    if (!filename) throw new BadRequestException('An attachment has no file name.');
    if (BLOCKED.test(filename)) throw new BadRequestException(`${filename}: program / script files can't be e-mailed.`);
    const b64 = String(a?.data ?? '').replace(/^data:[^,]*,/, '');
    const content = Buffer.from(b64, 'base64');
    if (!content.length) throw new BadRequestException(`${filename} is empty.`);
    total += content.length;
    if (total > 7 * 1024 * 1024) throw new BadRequestException('Attachments come to more than 7 MB — e-mail can\'t carry that. Send a smaller file or share a link instead.');
    return { filename, content, contentType: String(a?.type || '') || undefined };
  });
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Plain text from the editor → simple HTML: blank line = new paragraph, single newline = line break. */
const toHtml = (text: string) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937">${text.trim().split(/\n\s*\n/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;

/**
 * Bulk customer mail (#13-10) — one message (holiday closures, embargoes, service notices) to every customer's
 * MIS address (contact + reports email of every active customer), all in BCC so customers never see each
 * other. Accounts + Customer Service (feature '/bulk-mail') and super admin.
 */
@Controller('api/v1/bulk-mail')
@UseGuards(RolesGuard)
@Feature('/bulk-mail')
export class BulkMailController {
  constructor(private readonly prisma: PrismaService, private readonly mail: NotificationsService) {}

  private async recipients() {
    const cs = await this.prisma.b2bClient.findMany({ where: { isActive: true }, select: { accountCode: true, legalName: true, contactEmail: true, email2: true } });
    const seen = new Set<string>();
    const rows: { email: string; code: string; customer: string }[] = [];
    for (const c of cs) {
      for (const raw of `${c.contactEmail ?? ''},${c.email2 ?? ''}`.split(/[,;\s]+/)) {
        const e = NotificationsService.cleanEmail(raw);
        if (e && !seen.has(e)) { seen.add(e); rows.push({ email: e, code: c.accountCode ?? '', customer: c.legalName }); }
      }
    }
    return { customers: cs.length, rows };
  }

  @Get('recipients')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async list() {
    const r = await this.recipients();
    return { customers: r.customers, count: r.rows.length, rows: r.rows };
  }

  /** {subject, body, test?} — test sends only to the signed-in user. */
  @Post('send')
  @Roles(UserRole.FINANCE_EXEC, UserRole.SYS_ADMIN)
  async send(@Body() dto: { subject?: string; body?: string; test?: boolean; attachments?: { name: string; type?: string; data: string }[] }, @Req() req: any) {
    const subject = String(dto?.subject ?? '').trim();
    const body = String(dto?.body ?? '').trim();
    if (!subject) throw new BadRequestException('Enter a subject.');
    if (body.length < 10) throw new BadRequestException('Write the message.');
    const attachments = attachmentsOf(dto?.attachments);
    const me = await this.prisma.user.findUnique({ where: { id: BigInt(req.user.sub) }, select: { email: true, fullName: true } });
    if (dto?.test) {
      const to = NotificationsService.cleanEmail(me?.email ?? '');
      if (!to) throw new BadRequestException('Your login has no email address to send the test to.');
      const r = await this.mail.sendBulkBcc({ subject: `[TEST] ${subject}`, text: body, html: toHtml(body), bcc: [to], attachments });
      if (!r.sent) throw new BadRequestException('The test e-mail could not be sent — check the Tech Console.');
      return { ok: true, test: true, to, count: 1 };
    }
    const { rows } = await this.recipients();
    if (!rows.length) throw new BadRequestException('No customer has a MIS email address.');
    // Sends in the background (paced ~1 minute per 600 addresses); the result lands in the notification log.
    void this.mail.sendBulkBcc({ subject, text: body, html: toHtml(body), bcc: rows.map((x) => x.email), attachments }).then((r) =>
      this.prisma.notification.create({ data: { channel: 'email', recipient: `${rows.length} customer addresses (BCC)`, kind: 'bulk', message: `${subject} — by ${me?.fullName ?? me?.email ?? 'user'}: ${r.sent} sent, ${r.failed} failed`, status: r.failed ? 'queued' : 'sent' } }),
    ).catch(() => undefined);
    return { ok: true, test: false, count: rows.length, message: `Sending to ${rows.length} addresses in BCC — takes about ${Math.max(1, Math.ceil(rows.length / 600))} minute(s).` };
  }
}
