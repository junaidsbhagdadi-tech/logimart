import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PieceStatus, Prisma, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { buildZip } from '../../common/zip';

@Injectable()
export class PodsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Record Proof of Delivery. GPS is mandatory (DTO-enforced).
   * If fewer pieces are delivered than the AWB carries, the POD is BLOCKED
   * (409 with a missing-piece warning) unless ?force=true, which records a
   * short delivery and flags the shipment PARTIAL.
   */
  async createPod(awb: string, dto: CreatePodDto, deliveredById: bigint, force: boolean) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { awb },
      include: { pieces: { select: { status: true } } },
    });
    if (!shipment) throw new NotFoundException(`AWB ${awb} not found`);

    // DOD gate: a Draft-on-Delivery shipment cannot be delivered until the
    // cheque/DD has been collected from the consignee.
    if (shipment.isDod && !shipment.dodCollectedAt) {
      throw new ConflictException({
        message: `DOD not collected — delivery blocked. Collect the ${shipment.dodInstrument ?? 'cheque/DD'} (₹${shipment.dodAmount ?? '—'}) before recording POD.`,
        awb,
        dodAmount: shipment.dodAmount,
        dodInstrument: shipment.dodInstrument,
      });
    }

    const isShort = dto.piecesDelivered < shipment.pieceCount;
    if (isShort && !force) {
      throw new ConflictException({
        message: 'Missing pieces — POD blocked. Boxes are unaccounted for.',
        expected: shipment.pieceCount,
        deliveredNow: dto.piecesDelivered,
        hint: 'Resolve the missing boxes, or resend with ?force=true to record a short delivery.',
      });
    }

    // Offload signature / stamp images to Spaces (keys), inline fallback when unconfigured.
    const [signatureUrl, stampPhotoUrl] = await Promise.all([
      this.storage.store(dto.signatureUrl, 'sig'),
      this.storage.store(dto.stampPhotoUrl, 'stamp'),
    ]);
    const pod = await this.prisma.pod.create({
      data: {
        shipmentId: shipment.id,
        deliveredById,
        gpsLat: new Prisma.Decimal(dto.gpsLat),
        gpsLng: new Prisma.Decimal(dto.gpsLng),
        signatureUrl,
        stampPhotoUrl,
        piecesDelivered: dto.piecesDelivered,
        isShort,
        deliveredAt: new Date(),
      },
    });

    await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: isShort ? ShipmentStatus.PARTIAL : ShipmentStatus.DELIVERED },
    });

    // Mark the delivered pieces DELIVERED so billing (which bills delivered pieces) picks them up.
    if (isShort) {
      const ps = await this.prisma.shipmentPiece.findMany({
        where: { shipmentId: shipment.id }, orderBy: { sequenceNo: 'asc' }, select: { id: true },
      });
      const ids = ps.slice(0, dto.piecesDelivered).map((p) => p.id);
      if (ids.length) await this.prisma.shipmentPiece.updateMany({ where: { id: { in: ids } }, data: { status: PieceStatus.DELIVERED } });
    } else {
      await this.prisma.shipmentPiece.updateMany({ where: { shipmentId: shipment.id }, data: { status: PieceStatus.DELIVERED } });
    }

    await this.notifications.notify({
      channel: shipment.consigneePhone ? 'whatsapp' : 'inapp',
      recipient: shipment.consigneePhone ?? 'ops',
      kind: isShort ? 'shortage' : 'delivery',
      awb,
      shipmentId: shipment.id,
      message: isShort
        ? `SHORT delivery on ${awb}: ${dto.piecesDelivered}/${shipment.pieceCount} boxes delivered.`
        : `${awb} delivered in full (${dto.piecesDelivered} boxes). POD captured.`,
    });

    return { pod, isShort, expected: shipment.pieceCount };
  }

  /**
   * #23b — Attach (or replace) a POD image on an AWB from the tracking page, without running the full
   * delivery sign-off. Stores the image and sets shipment.podUrl. Does not change status.
   */
  /**
   * Bulk POD download → one ZIP: each AWB's POD image (our rider's / uploaded / the carrier's link), and for an
   * AWB delivered with only a carrier e-POD (BlueDart gives "received by", no image) a printable e-POD page.
   * POD-summary.csv lists every AWB with what was found. `clientId` limits a customer to its own AWBs.
   */
  async bulkZip(awbsIn: string[], clientId?: bigint | null) {
    const awbs = [...new Set((awbsIn ?? []).map((a) => String(a).trim().toUpperCase()).filter(Boolean))].slice(0, 300);
    if (!awbs.length) throw new ConflictException('Pick at least one AWB.');
    const ships = await this.prisma.shipment.findMany({
      where: { OR: [{ awb: { in: awbs } }, { forwardingAwb: { in: awbs } }, { bdWaybill: { in: awbs } }], ...(clientId != null ? { clientId } : {}) },
      select: { id: true, awb: true, forwardingAwb: true, bdWaybill: true, vendor: true, statusCode: true, statusAt: true, podUrl: true, podReceivedBy: true, consigneeName: true, consigneeCity: true, destPincode: true, pieceCount: true, client: { select: { accountCode: true, legalName: true } } },
    });
    const pods = await this.prisma.pod.findMany({ where: { shipmentId: { in: ships.map((s) => s.id) } }, orderBy: { deliveredAt: 'desc' }, select: { shipmentId: true, stampPhotoUrl: true, signatureUrl: true, deliveredAt: true } }).catch(() => [] as any[]);
    const podBy = new Map<string, any>(); for (const p of pods) if (!podBy.has(String(p.shipmentId))) podBy.set(String(p.shipmentId), p);
    const files: { name: string; data: Buffer }[] = [];
    const csv: string[] = ['AWB,Forwarding no,Customer,Consignee,Destination,Status,Delivered on,Received by,POD file'];
    const q = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const esc = (v: any) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const found = new Set<string>();
    for (const s of ships) {
      for (const k of [s.awb, s.forwardingAwb, s.bdWaybill]) if (k) found.add(String(k).toUpperCase());
      const p = podBy.get(String(s.id));
      const receivedBy = s.podReceivedBy ?? '';
      const deliveredOn = s.statusCode === 'DLD' && s.statusAt ? new Date(s.statusAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';
      let file = '';
      const src = await this.storage.resolve(s.podUrl ?? p?.stampPhotoUrl ?? p?.signatureUrl).catch(() => null);
      if (src) {
        try {
          let data: Buffer; let mime = '';
          const m = /^data:([^;]+);base64,(.*)$/s.exec(src);
          if (m) { mime = m[1]; data = Buffer.from(m[2], 'base64'); }
          else {
            const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
            const r = await fetch(src, { signal: ctl.signal }).finally(() => clearTimeout(t));
            if (!r.ok) throw new Error(String(r.status));
            mime = r.headers.get('content-type') || ''; data = Buffer.from(await r.arrayBuffer());
          }
          const ext = /pdf/i.test(mime) ? 'pdf' : /png/i.test(mime) ? 'png' : /webp/i.test(mime) ? 'webp' : 'jpg';
          file = `POD-${s.awb}.${ext}`;
          files.push({ name: file, data });
        } catch { file = ''; }
      }
      if (!file && s.statusCode === 'DLD') {
        // Carrier e-POD only — a printable delivery confirmation instead of an image.
        file = `ePOD-${s.awb}.html`;
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>e-POD ${esc(s.awb)}</title>
<style>body{font:14px Arial,sans-serif;margin:32px;color:#111}h1{font-size:20px;margin:0 0 4px}table{border-collapse:collapse;margin-top:16px}td{border:1px solid #999;padding:6px 10px}td:first-child{font-weight:700;background:#f3f3f3}</style></head>
<body><h1>Electronic Proof of Delivery</h1><div>No signed image was provided by the carrier — this is their delivery confirmation.</div><table>
<tr><td>AWB</td><td>${esc(s.awb)}</td></tr><tr><td>Carrier / forwarding no</td><td>${esc(s.vendor ?? '')} ${esc(s.bdWaybill ?? s.forwardingAwb ?? '')}</td></tr>
<tr><td>Customer</td><td>${esc(s.client?.accountCode)} — ${esc(s.client?.legalName)}</td></tr><tr><td>Consignee</td><td>${esc(s.consigneeName)}, ${esc(s.consigneeCity ?? '')} ${esc(s.destPincode ?? '')}</td></tr>
<tr><td>Pieces</td><td>${esc(s.pieceCount)}</td></tr><tr><td>Delivered on</td><td>${esc(deliveredOn)}</td></tr><tr><td>Received by</td><td>${esc(receivedBy || '—')}</td></tr>
</table></body></html>`;
        files.push({ name: file, data: Buffer.from(html, 'utf8') });
      }
      csv.push([s.awb, s.bdWaybill ?? s.forwardingAwb ?? '', `${s.client?.accountCode ?? ''} ${s.client?.legalName ?? ''}`, s.consigneeName, `${s.consigneeCity ?? ''} ${s.destPincode ?? ''}`, s.statusCode, deliveredOn, receivedBy, file || (s.statusCode === 'DLD' ? 'no image' : 'not delivered yet')].map(q).join(','));
    }
    for (const a of awbs) if (!found.has(a)) csv.push([a, '', '', '', '', 'NOT FOUND', '', '', ''].map(q).join(','));
    files.unshift({ name: 'POD-summary.csv', data: Buffer.from('﻿' + csv.join('\r\n'), 'utf8') });
    return { zip: buildZip(files), count: ships.length, images: files.filter((f) => f.name.startsWith('POD-') && f.name !== 'POD-summary.csv').length };
  }

  async attachPodImage(awb: string, dataUrl: string) {
    const s = await this.prisma.shipment.findUnique({ where: { awb: String(awb).trim().toUpperCase() }, select: { id: true } });
    if (!s) throw new NotFoundException(`AWB ${awb} not found`);
    if (!dataUrl) throw new ConflictException('No image provided.');
    const stored = await this.storage.store(dataUrl, 'pod');
    await this.prisma.shipment.update({ where: { id: s.id }, data: { podUrl: stored } });
    return { ok: true, awb };
  }
}
