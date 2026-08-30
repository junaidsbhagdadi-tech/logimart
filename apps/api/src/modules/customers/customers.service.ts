import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateClientDto, UpdateClientDto } from './dto/customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Account code from the legal-name initials + a sequence, if not supplied. */
  private async nextAccountCode(legalName: string): Promise<string> {
    // Configurable series: a CONFIG/CUSTOMER_CODE master with attrs { prefix, nextNo, pad } drives a
    // fixed running series (e.g. LMT + 0001). When set, use & advance it; the unique constraint on
    // accountCode still guards against a rare race. When unset, fall back to the initials scheme.
    const cfg = await this.prisma.masterEntry.findUnique({ where: { type_code: { type: 'CONFIG', code: 'CUSTOMER_CODE' } } });
    const a: any = cfg?.active ? (cfg.attrs ?? {}) : null;
    if (a && String(a.prefix ?? '').trim()) {
      const prefix = String(a.prefix).trim().toUpperCase();
      const pad = Math.max(1, Math.min(10, Number(a.pad) || 4));
      let n = Math.max(1, Number(a.nextNo) || 1);
      // Skip any codes already taken (e.g. imported), then reserve this one by advancing the series.
      // Bounded loop so a misconfigured series can't spin forever.
      for (let i = 0; i < 10000; i++) {
        const code = `${prefix}${String(n).padStart(pad, '0')}`;
        const taken = await this.prisma.b2bClient.findUnique({ where: { accountCode: code }, select: { id: true } });
        if (!taken) {
          await this.prisma.masterEntry.update({ where: { type_code: { type: 'CONFIG', code: 'CUSTOMER_CODE' } }, data: { attrs: { ...a, prefix, pad, nextNo: n + 1 } } });
          return code;
        }
        n++;
      }
    }
    const initials = legalName
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .replace(/[^A-Za-z]/g, '')
      .toUpperCase()
      .slice(0, 4) || 'CL';
    const count = await this.prisma.b2bClient.count();
    return `${initials}${String(count + 1).padStart(3, '0')}`;
  }

  // GSTIN format (billing-app parity): 2-digit state + 5 letters + 4 digits + letter + entity + Z + checksum
  private static GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

  async create(dto: CreateClientDto) {
    if (dto.gstin) {
      const g = dto.gstin.trim().toUpperCase();
      if (!CustomersService.GSTIN_RE.test(g)) throw new ConflictException(`Invalid GSTIN format: ${dto.gstin}`);
      if (!dto.allowSameGstin) {
        const dup = await this.prisma.b2bClient.findFirst({ where: { gstin: g }, select: { legalName: true } });
        if (dup) throw new ConflictException(`GSTIN ${g} already used by ${dup.legalName}. Tick "allow same GSTIN" to override.`);
      }
    }
    const accountCode = dto.accountCode ?? (await this.nextAccountCode(dto.legalName));
    try {
      return await this.prisma.b2bClient.create({
        data: {
          legalName: dto.legalName,
          accountCode,
          gstin: dto.gstin,
          pan: dto.pan,
          addressLine: dto.addressLine,
          addressLine2: dto.addressLine2,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          contactName: dto.contactName,
          contactPerson: dto.contactPerson,
          contactPhone: dto.contactPhone,
          contactEmail: dto.contactEmail,
          tel1: dto.tel1,
          tel2: dto.tel2,
          fax: dto.fax,
          billingState: dto.billingState,
          serviceCentre: dto.serviceCentre,
          origin: dto.origin,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          aadhaarNo: dto.aadhaarNo,
          dobAadhaar: dto.dobAadhaar ? new Date(dto.dobAadhaar) : undefined,
          passportNo: dto.passportNo,
          tanNo: dto.tanNo,
          invoiceFormat: dto.invoiceFormat,
          customerType: dto.customerType ?? undefined,
          registerType: dto.registerType ?? undefined,
          email2: dto.email2,
          iecCode: dto.iecCode,
          salesPerson: dto.salesPerson,
          salesPersonMobile: dto.salesPersonMobile,
          salesPersonEmail: dto.salesPersonEmail,
          csPerson: dto.csPerson,
          csPersonMobile: dto.csPersonMobile,
          csPersonEmail: dto.csPersonEmail,
          accountType: dto.accountType ?? undefined,
          billingCycle: dto.billingCycle ?? undefined,
          allowSameGstin: dto.allowSameGstin ?? false,
          creditLimit: new Prisma.Decimal(dto.creditLimit ?? 0),
          creditDays: dto.creditDays ?? 30,
          isOneTime: dto.isOneTime ?? false,
          isCash: dto.isCash ?? false,
          canCheckRates: dto.canCheckRates ?? false,
          commissionPct: new Prisma.Decimal(dto.commissionPct ?? 0),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`Account code ${accountCode} already exists`);
      }
      throw e;
    }
  }

  /** Bulk-create customers from imported rows. Reuses create() per row; reports per-row status. */
  async bulkCreate(rows: any[]) {
    const bool = (v: any) => v === true || ['true', '1', 'yes', 'y'].includes(String(v ?? '').trim().toLowerCase());
    const num = (v: any) => (v != null && String(v).trim() !== '' ? Number(v) : undefined);
    const results: { name: string; code?: string; ok: boolean; error?: string }[] = [];
    for (const r of rows) {
      const legalName = String(r.legalName ?? r.name ?? '').trim();
      if (!legalName) { results.push({ name: String(r.accountCode ?? '(blank)'), ok: false, error: 'legalName required' }); continue; }
      try {
        const c = await this.create({
          legalName,
          accountCode: r.accountCode || undefined,
          gstin: r.gstin || undefined, pan: r.pan || undefined,
          addressLine: r.addressLine || undefined, addressLine2: r.addressLine2 || undefined,
          city: r.city || undefined, state: r.state || undefined, pincode: r.pincode || undefined,
          contactName: r.contactName || undefined, contactPerson: r.contactPerson || undefined,
          contactPhone: r.contactPhone || undefined, contactEmail: r.contactEmail || undefined,
          tel1: r.tel1 || undefined, billingState: r.billingState || undefined,
          serviceCentre: r.serviceCentre || undefined, origin: r.origin || undefined,
          customerType: r.customerType || undefined, registerType: r.registerType || undefined,
          salesPerson: r.salesPerson || undefined,
          salesPersonMobile: r.salesPersonMobile || undefined,
          salesPersonEmail: r.salesPersonEmail || undefined,
          creditLimit: num(r.creditLimit), creditDays: num(r.creditDays),
          isCash: bool(r.isCash),
        } as any);
        results.push({ name: c.legalName, code: c.accountCode, ok: true });
      } catch (e: any) {
        results.push({ name: legalName, ok: false, error: e?.message ?? 'error' });
      }
    }
    return { total: rows.length, created: results.filter((x) => x.ok).length, results };
  }

  list() {
    return this.prisma.b2bClient.findMany({ orderBy: { legalName: 'asc' } });
  }

  /**
   * Super-admin: permanently delete the given customers and ALL their data — shipments + children,
   * invoices/ledger/notes/claims, rate cards/slabs, per-customer charges/fuel/volumetric, addresses,
   * pickups. Vendor-owned rate cards are untouched. Login users linked to a deleted customer are
   * detached (clientId nulled), not removed. FK-safe order. Used by the Customers select/delete.
   */
  async bulkDelete(ids: number[]) {
    const cids = (ids || []).map((x) => BigInt(x));
    if (!cids.length) return { ok: true, deleted: 0, detail: {} };
    const r: Record<string, number> = {};
    const del = async (k: string, fn: () => Promise<{ count: number }>) => { r[k] = (await fn()).count; };

    const shipments = await this.prisma.shipment.findMany({ where: { clientId: { in: cids } }, select: { id: true, awb: true } });
    const sIds = shipments.map((s) => s.id);
    const awbs = shipments.map((s) => s.awb);
    const pieces = await this.prisma.shipmentPiece.findMany({ where: { shipmentId: { in: sIds } }, select: { id: true } });
    const pieceIds = pieces.map((x) => x.id);
    const invoices = await this.prisma.invoice.findMany({ where: { clientId: { in: cids } }, select: { id: true } });
    const invIds = invoices.map((i) => i.id);

    await del('scanEvents', () => this.prisma.scanEvent.deleteMany({ where: { pieceId: { in: pieceIds } } }));
    await del('scanLogs', () => this.prisma.scanLog.deleteMany({ where: { awb: { in: awbs } } }));
    await del('pods', () => this.prisma.pod.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('invoiceLines', () => this.prisma.invoiceLineItem.deleteMany({ where: { OR: [{ shipmentId: { in: sIds } }, { invoiceId: { in: invIds } }] } }));
    await del('ledger', () => this.prisma.ledgerEntry.deleteMany({ where: { clientId: { in: cids } } }));
    await del('debitCreditNotes', () => this.prisma.debitCreditNote.deleteMany({ where: { clientId: { in: cids } } }));
    await del('claims', () => this.prisma.claim.deleteMany({ where: { clientId: { in: cids } } }));
    await del('invoices', () => this.prisma.invoice.deleteMany({ where: { clientId: { in: cids } } }));
    await del('shipmentPieces', () => this.prisma.shipmentPiece.deleteMany({ where: { shipmentId: { in: sIds } } }));
    await del('shipments', () => this.prisma.shipment.deleteMany({ where: { clientId: { in: cids } } }));
    await del('pickups', () => this.prisma.pickupRequest.deleteMany({ where: { clientId: { in: cids } } }));
    await del('customerAddresses', () => this.prisma.customerAddress.deleteMany({ where: { clientId: { in: cids } } }));
    await del('customerFuel', () => this.prisma.customerFuelSurcharge.deleteMany({ where: { clientId: { in: cids } } }));
    await del('customerCharges', () => this.prisma.customerOtherCharge.deleteMany({ where: { clientId: { in: cids } } }));
    await del('customerVolumetric', () => this.prisma.customerVolumetric.deleteMany({ where: { clientId: { in: cids } } }));
    await del('rateSlabs', () => this.prisma.clientRateSlab.deleteMany({ where: { clientId: { in: cids } } }));
    await del('customerRateCards', () => this.prisma.customerRateCard.deleteMany({ where: { clientId: { in: cids } } })); // vendor cards untouched
    await del('legacyRateCards', () => this.prisma.rateCard.deleteMany({ where: { clientId: { in: cids } } }));
    await del('ftlRates', () => this.prisma.ftlRate.deleteMany({ where: { clientId: { in: cids } } }));

    // detach child-account links + any portal users, then remove the customers
    await this.prisma.b2bClient.updateMany({ where: { parentAccountId: { in: cids } }, data: { parentAccountId: null } });
    await this.prisma.user.updateMany({ where: { clientId: { in: cids } }, data: { clientId: null } });
    await del('customers', () => this.prisma.b2bClient.deleteMany({ where: { id: { in: cids } } }));
    return { ok: true, deleted: r['customers'] || 0, detail: r };
  }

  async get(id: number) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(id) } });
    if (!c) throw new NotFoundException('Client not found');
    return c;
  }

  async update(id: number, dto: UpdateClientDto) {
    await this.get(id);
    const { startDate, dobAadhaar, creditLimit, parentAccountId, ...rest } = dto;
    // Resolve the account-group parent link: 0/null clears it; a value must be another account.
    let parentPatch: { parentAccountId?: bigint | null } = {};
    if (parentAccountId !== undefined) {
      if (parentAccountId === null || Number(parentAccountId) === 0) {
        parentPatch = { parentAccountId: null };
      } else {
        if (Number(parentAccountId) === Number(id)) throw new ConflictException('An account cannot be its own parent.');
        const parent = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(parentAccountId) }, select: { id: true, parentAccountId: true } });
        if (!parent) throw new NotFoundException('Parent account not found');
        // Keep the hierarchy one level deep: the chosen parent must itself be a top-level account.
        if (parent.parentAccountId != null) throw new ConflictException('The parent account is itself a child — pick the top-level (head-office) account.');
        parentPatch = { parentAccountId: BigInt(parentAccountId) };
      }
    }
    return this.prisma.b2bClient.update({
      where: { id: BigInt(id) },
      data: {
        ...rest,
        ...parentPatch,
        startDate: startDate ? new Date(startDate) : undefined,
        dobAadhaar: dobAadhaar ? new Date(dobAadhaar) : undefined,
        creditLimit: creditLimit != null ? new Prisma.Decimal(creditLimit) : undefined,
      },
    });
  }

  /**
   * Delete a customer. Blocked if the customer has transactional history
   * (shipments / invoices / ledger / notes / claims) — those must stay for audit.
   * A "clean" customer (only master-data config) is removed along with its config rows.
   */
  async remove(id: number) {
    const cid = BigInt(id);
    const c = await this.prisma.b2bClient.findUnique({
      where: { id: cid },
      include: { _count: { select: { shipments: true, invoices: true, ledger: true, notes: true, claims: true } } },
    });
    if (!c) throw new NotFoundException('Client not found');
    const blockers: string[] = [];
    if (c._count.shipments) blockers.push(`${c._count.shipments} shipment(s)`);
    if (c._count.invoices) blockers.push(`${c._count.invoices} invoice(s)`);
    if (c._count.ledger) blockers.push(`${c._count.ledger} ledger entr(ies)`);
    if (c._count.notes) blockers.push(`${c._count.notes} debit/credit note(s)`);
    if (c._count.claims) blockers.push(`${c._count.claims} claim(s)`);
    if (blockers.length) {
      throw new ConflictException(`${c.legalName} has ${blockers.join(', ')} — deactivate instead of deleting.`);
    }
    // Clean customer: remove its master-data config, then the customer.
    return this.prisma.$transaction([
      this.prisma.customerFuelSurcharge.deleteMany({ where: { clientId: cid } }),
      this.prisma.customerOtherCharge.deleteMany({ where: { clientId: cid } }),
      this.prisma.customerVolumetric.deleteMany({ where: { clientId: cid } }),
      this.prisma.customerAddress.deleteMany({ where: { clientId: cid } }),
      this.prisma.customerRateCard.deleteMany({ where: { clientId: cid } }),
      this.prisma.rateCard.deleteMany({ where: { clientId: cid } }),
      this.prisma.b2bClient.delete({ where: { id: cid } }),
    ]).then(() => ({ ok: true, id }));
  }

  // ============ sub-tabs (per customer) ============
  private dec(n: any) { return new Prisma.Decimal(n ?? 0); }
  private date(s?: string) { return s ? new Date(s) : null; }

  // ---- Fuel Surcharges ----
  listFuel(clientId: number) {
    return this.prisma.customerFuelSurcharge.findMany({ where: { clientId: BigInt(clientId) }, orderBy: { id: 'desc' } });
  }
  addFuel(clientId: number, d: any) {
    const num = (v: any) => (v != null && v !== '' ? new Prisma.Decimal(v) : null);
    return this.prisma.customerFuelSurcharge.create({ data: {
      clientId: BigInt(clientId), vendor: d.vendor, product: d.product, destination: d.destination, service: d.service,
      fromDate: this.date(d.fromDate), toDate: this.date(d.toDate),
      mechanism: d.mechanism || null,
      mode: (d.mode || 'FLAT').toUpperCase() === 'DYNAMIC' ? 'DYNAMIC' : 'FLAT',
      percentage: num(d.percentage),
      basePct: num(d.basePct), baseFuelPrice: num(d.baseFuelPrice), stepPerRupee: num(d.stepPerRupee), maxPct: num(d.maxPct),
    } });
  }
  delFuel(rowId: number) { return this.prisma.customerFuelSurcharge.delete({ where: { id: BigInt(rowId) } }); }

  // ---- Other Charges ----
  listCharges(clientId: number) {
    return this.prisma.customerOtherCharge.findMany({ where: { clientId: BigInt(clientId) }, orderBy: { id: 'desc' } });
  }
  addCharge(clientId: number, d: any) {
    return this.prisma.customerOtherCharge.create({ data: {
      clientId: BigInt(clientId), chargeDesc: d.chargeDesc, vendor: d.vendor || null, origin: d.origin, product: d.product,
      destination: d.destination, service: d.service, fromDate: this.date(d.fromDate), toDate: this.date(d.toDate),
      value: this.dec(d.value), minimumValue: d.minimumValue != null && d.minimumValue !== '' ? this.dec(d.minimumValue) : null,
    } });
  }
  delCharge(rowId: number) { return this.prisma.customerOtherCharge.delete({ where: { id: BigInt(rowId) } }); }

  // ---- Volumetric ----
  listVol(clientId: number) {
    return this.prisma.customerVolumetric.findMany({ where: { clientId: BigInt(clientId) }, orderBy: { id: 'desc' } });
  }
  addVol(clientId: number, d: any) {
    return this.prisma.customerVolumetric.create({ data: {
      clientId: BigInt(clientId), product: d.product, vendor: d.vendor, service: d.service,
      cft: this.dec(d.cft), cmDivide: this.dec(d.cmDivide), inchDivide: this.dec(d.inchDivide),
    } });
  }
  delVol(rowId: number) { return this.prisma.customerVolumetric.delete({ where: { id: BigInt(rowId) } }); }

  // ---- Addresses ----
  listAddr(clientId: number) {
    return this.prisma.customerAddress.findMany({ where: { clientId: BigInt(clientId) }, orderBy: { id: 'desc' } });
  }
  addAddr(clientId: number, d: any) {
    return this.prisma.customerAddress.create({ data: {
      clientId: BigInt(clientId), contactType: d.contactType, name: d.name || 'Address', designation: d.designation,
      email: d.email, mobile: d.mobile, landline: d.landline, addressLine1: d.addressLine1, addressLine2: d.addressLine2,
      addressLine3: d.addressLine3, pincode: d.pincode, city: d.city, state: d.state, country: d.country || 'India',
      gstNo: d.gstNo, panNo: d.panNo, aadhaarNo: d.aadhaarNo, iecNo: d.iecNo, adCode: d.adCode, lutNo: d.lutNo,
      isDefault: !!d.isDefault, isWarehouse: !!d.isWarehouse,
    } });
  }
  delAddr(rowId: number) { return this.prisma.customerAddress.delete({ where: { id: BigInt(rowId) } }); }

  // ============ wallet + walk-in ============

  /** Get-or-create the singleton cash walk-in customer (isCash, one-time). */
  async ensureWalkin() {
    const existing = await this.prisma.b2bClient.findUnique({ where: { accountCode: 'WALKIN' } });
    if (existing) return existing;
    return this.prisma.b2bClient.create({
      data: { legalName: 'Walk-in / Counter (Cash)', accountCode: 'WALKIN', isCash: true, isOneTime: true, accountType: 'CASH', customerType: 'Customer' },
    });
  }

  async walletInfo(id: number) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(id) }, select: { id: true, legalName: true, accountType: true, walletBalance: true } });
    if (!c) throw new NotFoundException('Client not found');
    return { clientId: c.id, legalName: c.legalName, accountType: c.accountType, walletBalance: Number(c.walletBalance) };
  }

  /** Top up a customer's prepaid wallet. Records a ledger entry (audit). */
  async walletTopup(id: number, amount: number, note?: string) {
    const c = await this.prisma.b2bClient.findUnique({ where: { id: BigInt(id) } });
    if (!c) throw new NotFoundException('Client not found');
    if (!(amount > 0)) throw new ConflictException('Top-up amount must be positive.');
    const balance = +(Number(c.walletBalance) + amount).toFixed(2);
    await this.prisma.b2bClient.update({ where: { id: c.id }, data: { walletBalance: new Prisma.Decimal(balance) } });
    await this.prisma.ledgerEntry.create({ data: { clientId: c.id, entryType: note ? `wallet_topup:${note}` : 'wallet_topup', amount: new Prisma.Decimal(-amount), balanceAfter: new Prisma.Decimal(balance) } });
    return { clientId: c.id, topup: amount, walletBalance: balance };
  }
}
