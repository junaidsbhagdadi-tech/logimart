import { useEffect, useMemo, useState } from 'react';
import { api, Client } from '../api';

type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox';
type Field = { key: string; label: string; type?: FieldType; options?: string[]; required?: boolean };
type Kind = 'fuel' | 'charges' | 'vol' | 'addr';

const CHARGE_TYPES = [
  'AIRWAYBILL CHARGES', 'APPOINTMENT DELIVERY', 'CHEQUE/DD ON DELIVERY', 'CURRENCY ADJUSTMENT FACTOR',
  'DEMMURAGE CHARGE', 'Emergency Sit. Surhrg.', 'ENVIRONMENTAL SURCHARGE', 'EXTRA DELIVERY LOCATION',
  'Freight', 'FREIGHT ON VALUE', 'INFRA DEVELPOMENT', 'OVER SIZE PCS', 'PACKAGING CHARGE',
  'PICKUP CHARGES', 'RAS CHARGE', 'Re Attempt', 'TOPAY CHARGES', 'VALUABLE CARGO HANDLING CHARGE',
];

const CONFIG: Record<Kind, { fields: Field[]; cols: string[] }> = {
  fuel: {
    fields: [
      { key: 'mechanism', label: 'Mechanism (Masters → Fuel Mechanism code — overrides below)' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['FLAT', 'DYNAMIC'] },
      { key: 'percentage', label: 'Flat %  (FLAT)', type: 'number' },
      { key: 'basePct', label: 'Base %  (DYNAMIC)', type: 'number' },
      { key: 'baseFuelPrice', label: 'Base diesel ₹/L — reference (DYNAMIC)', type: 'number' },
      { key: 'stepPerRupee', label: '% per ₹1 rise  (DYNAMIC)', type: 'number' },
      { key: 'maxPct', label: 'Max % cap  (DYNAMIC, default 50)', type: 'number' },
      { key: 'product', label: 'Product' }, { key: 'service', label: 'Service' },
      { key: 'vendor', label: 'Vendor' }, { key: 'destination', label: 'Destination' },
      { key: 'fromDate', label: 'From Date', type: 'date' }, { key: 'toDate', label: 'To Date', type: 'date' },
    ],
    cols: ['mechanism', 'mode', 'percentage', 'basePct', 'baseFuelPrice', 'stepPerRupee', 'service'],
  },
  charges: {
    fields: [
      { key: 'chargeDesc', label: 'Charge Desc *', type: 'select', options: CHARGE_TYPES, required: true },
      { key: 'vendor', label: 'Vendor (blank = all)' },
      { key: 'fromDate', label: 'From Date', type: 'date' }, { key: 'toDate', label: 'To Date', type: 'date' },
      { key: 'origin', label: 'Origin' }, { key: 'product', label: 'Product' }, { key: 'destination', label: 'Destination' },
      { key: 'service', label: 'Service' }, { key: 'value', label: 'Value *', type: 'number', required: true },
      { key: 'minimumValue', label: 'Minimum Value', type: 'number' },
    ],
    cols: ['chargeDesc', 'vendor', 'destination', 'service', 'fromDate', 'toDate', 'value', 'minimumValue'],
  },
  vol: {
    fields: [
      { key: 'product', label: 'Product' }, { key: 'vendor', label: 'Vendor' }, { key: 'service', label: 'Service' },
      { key: 'cmDivide', label: 'Divisor (cm³ per CFT, e.g. 28317) *', type: 'number', required: true },
      { key: 'cft', label: 'CFT factor (kg per CFT) *', type: 'number', required: true },
      { key: 'inchDivide', label: 'Inches Divisor (opt.)', type: 'number' },
    ],
    cols: ['product', 'vendor', 'service', 'cft', 'cmDivide', 'inchDivide'],
  },
  addr: {
    fields: [
      { key: 'contactType', label: 'Contact Type' }, { key: 'name', label: 'Name *', required: true },
      { key: 'designation', label: 'Designation' }, { key: 'email', label: 'Email' },
      { key: 'mobile', label: 'Mobile No.' }, { key: 'landline', label: 'Landline No.' },
      { key: 'addressLine1', label: 'Address 1' }, { key: 'addressLine2', label: 'Address 2' },
      { key: 'addressLine3', label: 'Address 3' }, { key: 'pincode', label: 'PinCode' },
      { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'country', label: 'Country' },
      { key: 'gstNo', label: 'GST No.' }, { key: 'panNo', label: 'PAN No.' }, { key: 'aadhaarNo', label: 'Aadhar No.' },
      { key: 'iecNo', label: 'IEC No.' }, { key: 'adCode', label: 'AD Code' }, { key: 'lutNo', label: 'LUT No.' },
      { key: 'isDefault', label: 'Default Shipper', type: 'checkbox' },
    ],
    cols: ['contactType', 'name', 'city', 'state', 'mobile', 'gstNo'],
  },
};

// Fuel / Other-Charges / Volumetric here feed the LEGACY weight-slab tariff only. When a customer
// has a rate card (👁 Cards), the card's FSC / FOV / volumetric wins and these rows are ignored —
// so they are not a duplicate charge, just the fallback for un-migrated slab customers.
const LEGACY_NOTE: Partial<Record<Kind, string>> = {
  fuel: 'Applies to the legacy weight-slab tariff only. If this customer has a rate card (👁 Cards), the card’s FSC wins and this is ignored — set fuel on the rate card instead.',
  charges: 'Applies to the legacy weight-slab tariff only. Rate-card customers get FOV/accessorials from the card (👁 Cards); these rows are the fallback for un-migrated slab customers.',
  vol: 'Applies to the legacy weight-slab tariff only. Rate-card customers use the card’s volumetric divisor; this is the fallback for un-migrated slab customers.',
};

const CALLS = {
  fuel: { list: api.listFuel, add: api.addFuel, del: api.delFuel },
  charges: { list: api.listCharges, add: api.addCharge, del: api.delCharge },
  vol: { list: api.listVol, add: api.addVol, del: api.delVol },
  addr: { list: api.listAddr, add: api.addAddr, del: api.delAddr },
};

export function CustomerSubTab({ clients, kind }: { clients: Client[]; kind: Kind }) {
  const cfg = CONFIG[kind];
  const [clientId, setClientId] = useState('');
  const [form, setForm] = useState<Record<string, any>>({});
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (!clientId) { setRows([]); return; }
    CALLS[kind].list(clientId).then(setRows).catch((e) => setError(e.message));
  };
  useEffect(load, [clientId, kind]);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setError('');
    if (!clientId) { setError('Select a customer first.'); return; }
    for (const f of cfg.fields) if (f.required && !form[f.key]) { setError(`${f.label.replace(' *', '')} is required.`); return; }
    setBusy(true);
    try { await CALLS[kind].add(clientId, form); setForm({}); load(); }
    catch (e: any) { setError(e.message); }
    setBusy(false);
  };

  const remove = async (rowId: string) => {
    setError('');
    try { await CALLS[kind].del(clientId, rowId); load(); }
    catch (e: any) { setError(e.message); }
  };

  const clientName = useMemo(() => clients.find((c) => String(c.id) === clientId)?.legalName, [clients, clientId]);

  return (
    <>
      {error && <div className="error">{error}</div>}
      {LEGACY_NOTE[kind] && (
        <div className="card" style={{ borderLeft: '4px solid var(--warn)', marginBottom: 10, fontSize: 12.5 }}>
          ⚠ {LEGACY_NOTE[kind]}
        </div>
      )}
      <div className="grid cols-3" style={{ marginBottom: 8 }}>
        <div>
          <label>Customer *</label>
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— select customer —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
          </select>
        </div>
      </div>

      {clientId ? (
        <>
          <div className="grid cols-4">
            {cfg.fields.map((f) => (
              <div key={f.key}>
                <label>{f.label}</label>
                {f.type === 'select' ? (
                  <select value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                    <option value="">— select —</option>
                    {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : f.type === 'checkbox' ? (
                  <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)', marginTop: 6 }}>
                    <input type="checkbox" style={{ width: 'auto' }} checked={!!form[f.key]} onChange={(e) => set(f.key, e.target.checked)} /> yes
                  </label>
                ) : (
                  <input type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={save} disabled={busy}>{busy ? 'Saving…' : '+ Add'}</button>
          </div>

          <table style={{ marginTop: 16 }}>
            <thead><tr>{cfg.cols.map((c) => <th key={c}>{c}</th>)}<th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {cfg.cols.map((c) => <td key={c}>{fmt(r[c])}</td>)}
                  <td><button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => remove(String(r.id))}>✕</button></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={cfg.cols.length + 1} className="muted">No rows for {clientName}.</td></tr>}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted">Select a customer to add and view rows.</p>
      )}
    </>
  );
}

function fmt(v: any): string {
  if (v == null || v === '') return '—';
  if (typeof v === 'boolean') return v ? '✓' : '—';
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return v.slice(0, 10);
  return String(v);
}
