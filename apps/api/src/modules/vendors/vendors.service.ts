import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class VendorsService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- Vendor branch/location contacts (multiple per location, optionally product-wise) ----
  listContacts(vendorId: number) {
    return this.prisma.vendorContact.findMany({ where: { vendorId: BigInt(vendorId) }, orderBy: [{ location: 'asc' }, { personName: 'asc' }] });
  }

  addContact(vendorId: number, dto: any) {
    if (!String(dto.location || '').trim() || !String(dto.personName || '').trim()) throw new BadRequestException('Location and contact name are required.');
    return this.prisma.vendorContact.create({
      data: {
        vendorId: BigInt(vendorId),
        location: String(dto.location).trim().toUpperCase(),
        product: dto.product?.trim() || null,
        personName: String(dto.personName).trim(),
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        role: dto.role?.trim() || null,
      },
    });
  }

  async removeContact(id: number) {
    await this.prisma.vendorContact.delete({ where: { id: BigInt(id) } });
    return { ok: true };
  }

  private vendorData(dto: any) {
    return {
      name: dto.name,
      modes: (dto.modes || []).join?.(',') ?? dto.modes ?? '',
      gstin: dto.gstin, pan: dto.pan, addressLine: dto.addressLine, city: dto.city, state: dto.state, pincode: dto.pincode,
      contactName: dto.contactName, contactPhone: dto.contactPhone, contactEmail: dto.contactEmail,
      vendorCode: dto.vendorCode || null, contactPerson: dto.contactPerson || null, addressLine2: dto.addressLine2 || null,
      tel1: dto.tel1 || null, tel2: dto.tel2 || null, fax: dto.fax || null, website: dto.website || null, mode: dto.mode || null,
      fuelHead: dto.fuelHead || null, currency: dto.currency || 'INR', origin: dto.origin || null, vendorZip: dto.vendorZip || null,
      isGlobal: !!dto.isGlobal, gstEnabled: !!dto.gstEnabled, volRoundOff: !!dto.volRoundOff,
    };
  }

  async update(id: number, dto: any) {
    await this.get(id);
    return this.prisma.vendor.update({ where: { id: BigInt(id) }, data: this.vendorData(dto) });
  }

  async remove(id: number) {
    await this.get(id);
    return this.prisma.vendor.delete({ where: { id: BigInt(id) } });
  }

  create(dto: any) {
    return this.prisma.vendor.create({
      data: {
        name: dto.name,
        modes: (dto.modes || []).join?.(',') ?? dto.modes ?? '',
        gstin: dto.gstin,
        pan: dto.pan,
        addressLine: dto.addressLine,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        contactEmail: dto.contactEmail,
        // Xpresion parity
        vendorCode: dto.vendorCode || null,
        contactPerson: dto.contactPerson || null,
        addressLine2: dto.addressLine2 || null,
        tel1: dto.tel1 || null,
        tel2: dto.tel2 || null,
        fax: dto.fax || null,
        website: dto.website || null,
        mode: dto.mode || null,
        fuelHead: dto.fuelHead || null,
        currency: dto.currency || 'INR',
        origin: dto.origin || null,
        vendorZip: dto.vendorZip || null,
        isGlobal: !!dto.isGlobal,
        gstEnabled: !!dto.gstEnabled,
        volRoundOff: !!dto.volRoundOff,
      },
    });
  }

  // ---- Service Mapping (vendor → service → billing vendor, weight bands) ----
  listMappings() {
    return this.prisma.serviceMapping.findMany({ orderBy: [{ vendor: 'asc' }, { serviceType: 'asc' }] });
  }
  addMapping(dto: any) {
    return this.prisma.serviceMapping.create({
      data: {
        vendor: dto.vendor,
        serviceType: dto.serviceType || 'SELF',
        billingVendor: dto.billingVendor || null,
        minWeight: new Prisma.Decimal(dto.minWeight ?? 0),
        maxWeight: new Prisma.Decimal(dto.maxWeight ?? 0),
        vendorLink: dto.vendorLink || null,
        isSinglePiece: !!dto.isSinglePiece,
      },
    });
  }
  delMapping(id: number) {
    return this.prisma.serviceMapping.delete({ where: { id: BigInt(id) } });
  }

  /**
   * Auto-pick a carrier at booking from Service Mapping: the active mapping whose weight band
   * contains the shipment's chargeable weight (max 0 = open-ended), matching service when given.
   * A single-piece-only mapping applies only to single-piece shipments; others apply to any.
   * Ties break to the tightest (most specific) band.
   */
  async resolveCarrier(params: { weight: number; service?: string; singlePiece?: boolean }) {
    const w = Number(params.weight ?? 0);
    const rows = await this.prisma.serviceMapping.findMany({ where: { isActive: true } });
    const eq = (a?: string, b?: string) => !a || (b != null && String(a).toUpperCase() === String(b).toUpperCase());
    const band = (m: any) => (Number(m.maxWeight ?? 0) > 0 ? Number(m.maxWeight) - Number(m.minWeight ?? 0) : 1e9);
    const matches = rows
      .filter((m) => {
        const min = Number(m.minWeight ?? 0), max = Number(m.maxWeight ?? 0);
        const inBand = w >= min && (max <= 0 || w <= max);
        const svcOk = eq(params.service, m.serviceType);
        const spOk = m.isSinglePiece ? params.singlePiece === true : true;
        return inBand && svcOk && spOk;
      })
      .sort((a, b) => band(a) - band(b));
    const best = matches[0];
    return best
      ? { vendor: best.vendor, billingVendor: best.billingVendor, vendorLink: best.vendorLink, serviceType: best.serviceType, minWeight: Number(best.minWeight), maxWeight: Number(best.maxWeight) }
      : null;
  }

  async list() {
    const vendors = await this.prisma.vendor.findMany({
      orderBy: { name: 'asc' },
      include: { payments: true },
    });
    return vendors.map((v) => {
      const advPaid = v.payments.filter((p) => p.kind === 'advance' && p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0);
      const advPending = v.payments.filter((p) => p.kind === 'advance' && p.status === 'pending').reduce((s, p) => s + Number(p.amount), 0);
      return { ...v, payments: undefined, advancePaid: advPaid, advancePending: advPending };
    });
  }

  async get(id: number) {
    const v = await this.prisma.vendor.findUnique({
      where: { id: BigInt(id) },
      include: { payments: { orderBy: { createdAt: 'desc' } } },
    });
    if (!v) throw new NotFoundException('Vendor not found');
    return v;
  }

  addPayment(id: number, dto: any) {
    return this.prisma.vendorPayment.create({
      data: {
        vendorId: BigInt(id),
        amount: new Prisma.Decimal(dto.amount),
        tds: new Prisma.Decimal(dto.tds ?? 0),
        kind: dto.kind || 'advance', // advance | settlement
        status: dto.status || 'pending', // pending | paid
        reference: dto.reference,
        notes: dto.notes,
      },
    });
  }

  async markPaid(paymentId: number) {
    return this.prisma.vendorPayment.update({ where: { id: BigInt(paymentId) }, data: { status: 'paid' } });
  }
}
