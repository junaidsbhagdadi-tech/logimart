import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Bulk booking in the QUICK BOOKING format — one Excel row per shipment, the same fields as the
 * quick-booking form (customer, product, carrier, parcel/doc, pickup elsewhere, consignee, boxes +
 * size, total weight, content, numbers). Each row is booked exactly like a quick booking.
 */
const COLS = [
  'Customer code', 'Product', 'Carrier', 'Parcel / Doc', 'Pickup address', 'Pickup pincode', 'Pickup phone',
  'Consignee name', 'Consignee pincode', 'Consignee phone', 'Consignee address', 'Consignee GSTIN',
  'Boxes', 'L cm', 'W cm', 'H cm', 'Total weight kg', 'Content', 'AWB no', 'Forwarding AWB', 'Reference no',
  'Invoice no', 'Invoice value', 'E-way bill no',
] as const;
const REQUIRED = ['Customer code', 'Product', 'Consignee name', 'Consignee pincode', 'Total weight kg'];
const SAMPLE: Record<string, string | number> = {
  'Customer code': '111531', Product: 'SFC', Carrier: 'DLY', 'Parcel / Doc': 'PARCEL', 'Consignee name': 'Nikhil Verma', 'Consignee pincode': '110037',
  'Consignee phone': '9800000000', 'Consignee address': 'Plot 12, Mahipalpur', Boxes: 2, 'L cm': 30, 'W cm': 20, 'H cm': 20, 'Total weight kg': 12,
  Content: 'Garments', 'Reference no': 'PO-1001', 'Invoice no': 'INV-55', 'Invoice value': 18000,
};
type Row = Record<string, string>;
type Result = { row: number; ok: boolean; awb?: string; error?: string; consignee: string };

const hk = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function QuickBulk() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<{ code: string; surface: boolean }[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [results, setResults] = useState<Result[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.bookingCustomers().then(setCustomers).catch(() => {});
    api.listMaster('PRODUCT').then((r) => setProducts(r.filter((x) => x.active !== false).map((x) => {
      const a: any = x.attrs || {};
      const mode = String(a.service || a.mode || a.serviceMode || a.groupType || '');
      return { code: x.code, surface: /SURF|ROAD|RAIL/i.test(mode) || /SFC|SURFACE|ROAD|RAIL|HUB/i.test(x.code) };
    }))).catch(() => {});
  }, []);

  const template = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet([SAMPLE], { header: [...COLS] });
    ws['!cols'] = COLS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Quick booking');
    XLSX.writeFile(wb, 'quick-booking-bulk-template.xlsx');
  };

  const onFile = async (f?: File) => {
    if (!f) return;
    setErr(''); setResults([]); setDone(0); setFile(f.name);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      // Map the file's headers onto ours, ignoring case / spaces / punctuation.
      const norm = raw.map((r) => {
        const out: Row = {};
        for (const [k, v] of Object.entries(r)) { const col = COLS.find((c) => hk(c) === hk(k)); if (col) out[col] = String(v ?? '').trim(); }
        return out;
      }).filter((r) => Object.values(r).some(Boolean));
      if (!norm.length) throw new Error('No rows found — use the template headers.');
      setRows(norm);
    } catch (e: any) { setErr(e.message); setRows(null); }
  };

  const bookAll = async () => {
    if (!rows?.length) return;
    setBusy(true); setErr(''); setResults([]); setDone(0);
    const out: Result[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const consignee = r['Consignee name'] || '';
      try {
        const miss = REQUIRED.filter((c) => !String(r[c] ?? '').trim());
        if (miss.length) throw new Error(`missing ${miss.join(', ')}`);
        const code = r['Customer code'].trim().toLowerCase();
        const c = customers.find((x) => String(x.accountCode).toLowerCase() === code);
        if (!c) throw new Error(`customer ${r['Customer code']} not found (or not bookable by you)`);
        const product = r.Product.trim().toUpperCase();
        const sel = products.find((p) => p.code === product);
        if (!sel) throw new Error(`product ${product} not found`);
        const pin = r['Consignee pincode'].replace(/\D/g, '');
        if (!/^\d{6}$/.test(pin)) throw new Error('consignee pincode must be 6 digits');
        const kg = Number(r['Total weight kg']);
        if (!(kg > 0)) throw new Error('total weight must be > 0');
        const boxes = Math.max(1, Math.floor(Number(r.Boxes) || 1));
        const L = Number(r['L cm']) || 0, W = Number(r['W cm']) || 0, H = Number(r['H cm']) || 0;
        const elsewhere = !!r['Pickup address'];
        const pickPin = r['Pickup pincode'].replace(/\D/g, '');
        if (elsewhere && !/^\d{6}$/.test(pickPin)) throw new Error('pickup pincode must be 6 digits');
        const originPin = elsewhere ? pickPin : (c.pincode ?? '');
        const inv = Number(r['Invoice value']) > 0 ? Number(r['Invoice value']) : undefined;
        const opt = (k: string) => String(r[k] ?? '').trim() || undefined;
        const res = await api.createShipment({
          clientId: Number(c.id), product, docType: /^DOC|^DOX/i.test(r['Parcel / Doc'] || '') ? 'DOX' : 'NDOX', serviceMode: sel.surface ? 'ROAD_PTL' : 'AIR_EXPRESS',
          originZone: 'SOUTH', destZone: 'SOUTH',
          originPincode: originPin || undefined, destPincode: pin,
          shipperName: c.legalName, shipperContact: c.contactName || undefined,
          shipperAddress1: elsewhere ? r['Pickup address'] : (c.addressLine || undefined),
          shipperPincode: originPin || undefined, shipperCity: elsewhere ? undefined : (c.city || undefined),
          shipperMobile: (elsewhere ? opt('Pickup phone') : c.contactPhone) || undefined,
          consigneeName: consignee, consigneePhone: opt('Consignee phone'), consigneeAddress: opt('Consignee address'), consigneeGstin: opt('Consignee GSTIN')?.toUpperCase(),
          vendor: opt('Carrier')?.toUpperCase(),
          forwardingAwb: opt('Forwarding AWB')?.toUpperCase(), manualAwb: opt('AWB no')?.toUpperCase(), referenceNo: opt('Reference no'), goodsDesc: opt('Content'),
          shipmentValue: inv, declaredValue: inv, invoiceNo: opt('Invoice no'), ewbNo: opt('E-way bill no'),
          paymentTerm: 'PREPAID',
          pieces: Array.from({ length: boxes }, () => ({ deadKg: +(kg / boxes).toFixed(3), lengthCm: L || undefined, widthCm: W || undefined, heightCm: H || undefined })),
        } as any);
        out.push({ row: i + 2, ok: true, awb: res.awb, consignee });
      } catch (e: any) {
        out.push({ row: i + 2, ok: false, error: e.message, consignee });
      }
      setDone(i + 1); setResults([...out]);
    }
    setBusy(false);
  };

  const exportResults = async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.map((r) => ({ 'Excel row': r.row, Consignee: r.consignee, Result: r.ok ? 'Booked' : 'Failed', AWB: r.awb ?? '', Error: r.error ?? '' }))), 'Results');
    XLSX.writeFile(wb, `bulk-booking-results-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const ok = results.filter((r) => r.ok).length;
  return (
    <div>
      <div className="card" style={{ margin: '6px 0' }}>
        <h2 style={{ marginTop: 0 }}>⬆ Bulk booking — quick-booking format</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: -4 }}>
          One row per shipment, same fields as the quick-booking form. Required: <b>{REQUIRED.join(', ')}</b>. Blank AWB = auto-generated.
          Boxes share one size per row (L/W/H optional). Leave the pickup columns blank to pick up from the customer's own address.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="secondary" onClick={template}>⬇ Template</button>
          <label className="button secondary" style={{ padding: '8px 14px', cursor: 'pointer', border: '1px solid var(--border, #d0d5dd)', borderRadius: 8, fontWeight: 600 }}>
            📎 Choose Excel<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {file && <span className="muted" style={{ fontSize: 12.5 }}>{file}{rows ? ` · ${rows.length} row(s)` : ''}</span>}
        </div>
        {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
        {rows && (
          <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
            <button onClick={bookAll} disabled={busy}>{busy ? `Booking ${done}/${rows.length}…` : `Book ${rows.length} shipment(s)`}</button>
            {results.length > 0 && <span style={{ fontSize: 13 }}><b style={{ color: 'var(--ok, #16a34a)' }}>{ok} booked</b>{results.length - ok ? <> · <b style={{ color: 'var(--bad, #c0392b)' }}>{results.length - ok} failed</b></> : null}</span>}
            {results.length > 0 && !busy && <button className="secondary" onClick={exportResults}>⬇ Results</button>}
          </div>
        )}
      </div>
      {results.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Row</th><th>Consignee</th><th>Result</th></tr></thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td><td>{r.consignee || '—'}</td>
                  <td>{r.ok ? <a href={`/tracker/${r.awb}`} target="_blank" rel="noreferrer"><b>{r.awb}</b></a> : <span style={{ color: 'var(--bad, #c0392b)' }}>{r.error}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
