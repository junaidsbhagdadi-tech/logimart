import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';
import { AirFuelDefaults } from '../components/AirFuelDefaults';

type Field = { key: string; label: string; type?: 'text' | 'number' | 'select' | 'checkbox'; options?: string[]; attr?: boolean };
type MasterDef = { key: string; label: string; icon: string; fields: Field[] };

const F = (key: string, label: string, extra: Partial<Field> = {}): Field => ({ key, label, type: 'text', ...extra });

// Charge codes the rate card owns as built-in heads — must NOT be recreated as CHARGE-master rows
// (billing skips them, so a duplicate FSC/FUEL/etc. here does nothing and invites double-fuel confusion).
const RESERVED_CHARGE = new Set(['FSC', 'FUEL', 'FREIGHT', 'FOV', 'ODA', 'TOPAY', 'APPT', 'LOADING', 'UNLOADING', 'DOCKET', 'AWB', 'EMERGENCY', 'ENVIRONMENT', 'ENVIRONMENTAL', 'OSP']);

// Human labels for the CHARGE "Calculated on" basis. The stored VALUE stays machine-readable
// for the rate engine (baseOn === 'FREIGHT' → % of freight, includes 'WEIGHT' → per kg, etc.).
const BASEON_LABEL: Record<string, string> = {
  'FLAT': 'Flat ₹', 'CHARGEABLE WEIGHT': '₹ per chargeable kg', 'ACTUAL WEIGHT': '₹ per actual kg',
  'FREIGHT': '% of Freight', 'SHIPMENT VALUE': '% of Shipment Value', 'ODA': 'ODA (flat + ₹/kg, min)',
};
const baseOnLabel = (v?: string) => (v ? (BASEON_LABEL[String(v).toUpperCase()] ?? v) : '—');

// Fuel-mechanism "Calculation type" — FLAT (fixed %, air/FSC) vs DYNAMIC (diesel-indexed, surface/DSC).
// This is the MATH method, not the transport mode.
const FUELMODE_LABEL: Record<string, string> = {
  FLAT: 'FLAT — fixed % (Air / FSC)',
  DYNAMIC: 'DYNAMIC — diesel-indexed (Surface / DSC)',
};
const fuelModeLabel = (v?: string) => (v ? (FUELMODE_LABEL[String(v).toUpperCase()] ?? v) : '—');

// Built-in charges have a basis fixed by the rate engine (ODA formula, APPT per-kg+min, EMERGENCY
// % of freight). The rate/min entered here is the DEFAULT; a customer rate card overrides it.
// Fixed display basis so the "Calculated on" column is always accurate regardless of stored attrs.
const RESERVED_BASIS: Record<string, string> = {
  ODA: 'ODA (flat + ₹/kg, min)', APPT: '₹ per chargeable kg (min applies)', FOV: '% of Shipment Value (min)',
  AWB: 'Flat ₹', OSP: 'Flat ₹ (oversize)', FSC: '% of Freight (fuel)', FUEL: '% of Freight (fuel)',
  TOPAY: 'Flat ₹', DOCKET: 'Flat ₹', LOADING: 'Flat ₹', UNLOADING: 'Flat ₹',
  EMERGENCY: '% of Freight', ENVIRONMENT: 'Flat ₹', ENVIRONMENTAL: 'Flat ₹',
};

// Each master type = a config of fields. `attr:true` fields live in the JSON `attrs`;
// code/name are the natural key + label. Adding a master = adding a config entry.
const MASTERS: MasterDef[] = [
  { key: 'PRODUCT', label: 'Product / Service', icon: '📦', fields: [
    F('code', 'Product code'), F('name', 'Product name'),
    F('productType', 'Product type', { attr: true, type: 'select', options: ['Domestic', 'International', 'Local', 'Import'] }),
    F('groupType', 'Group', { attr: true, type: 'select', options: ['Air', 'Surface', 'Train', 'All'] }),
    F('docType', 'DOX / NDOX', { attr: true, type: 'select', options: ['DOX', 'NDOX'] }),
    F('service', 'Service', { attr: true }),
    F('fuelCharge', 'Fuel charge', { attr: true, type: 'checkbox' }),
    F('gstReverse', 'GST reverse', { attr: true, type: 'checkbox' }),
  ] },
  { key: 'PRODUCT_TYPE', label: 'Product Type', icon: '🏷', fields: [F('code', 'Type code'), F('name', 'Type name')] },
  { key: 'FUEL_MECHANISM', label: 'Fuel / Diesel Surcharge', icon: '⛽', fields: [
    F('code', 'Code'), F('name', 'Name'),
    F('mode', 'Calculation type (not transport mode)', { attr: true, type: 'select', options: ['FLAT', 'DYNAMIC'] }),
    F('isDefault', 'Default for its type (cards with blank fuel inherit — FLAT→Air/FSC, DYNAMIC→Surface/DSC)', { attr: true, type: 'checkbox' }),
    F('percentage', 'Flat %  (FLAT — fixed, e.g. 25)', { attr: true, type: 'number' }),
    F('basePct', 'Base DSC %  (DYNAMIC — the base surcharge, e.g. 10)', { attr: true, type: 'number' }),
    F('baseFuelPrice', 'Base diesel ₹/L  (DYNAMIC — blank → ₹98.33)', { attr: true, type: 'number' }),
    F('stepPerRupee', '% per ₹1 diesel rise  (DYNAMIC — e.g. 2)', { attr: true, type: 'number' }),
    F('maxPct', 'Max % cap  (DYNAMIC — e.g. 50)', { attr: true, type: 'number' }),
  ] },
  { key: 'CHARGE', label: 'Charges', icon: '💱', fields: [
    F('code', 'Charge code'), F('name', 'Charge name'),
    F('baseOn', 'Calculated on', { attr: true, type: 'select', options: ['FLAT', 'Chargeable Weight', 'Actual Weight', 'Freight', 'Shipment Value', 'ODA'] }),
    F('rate', 'Default Rate (₹ / % / ₹per-kg)', { attr: true, type: 'number' }),
    F('min', 'Default Min ₹ (opt)', { attr: true, type: 'number' }),
    F('perKg', '₹ per kg (ODA only, opt)', { attr: true, type: 'number' }),
    F('hsn', 'HSN', { attr: true }),
    F('sequence', 'Sequence', { attr: true, type: 'number' }),
    F('applyFuel', 'FSC applicable (apply fuel)', { attr: true, type: 'checkbox' }),
    F('taxOnFuel', 'Tax on fuel', { attr: true, type: 'checkbox' }),
    F('tax', 'Apply tax', { attr: true, type: 'checkbox' }),
  ] },
  { key: 'ZONE', label: 'Zone', icon: '🗺', fields: [F('code', 'Zone code'), F('name', 'Zone name')] },
  { key: 'COUNTRY', label: 'Country', icon: '🌍', fields: [
    F('code', 'Country code'), F('name', 'Country name'),
    F('weightUnit', 'Weight unit', { attr: true }), F('currency', 'Currency', { attr: true }),
  ] },
  { key: 'STATE', label: 'State', icon: '📍', fields: [
    F('code', 'State code'), F('name', 'State name'),
    F('zone', 'Zone', { attr: true }), F('gstCode', 'GST state code', { attr: true }),
    F('unionTerritory', 'Union territory', { attr: true, type: 'checkbox' }),
  ] },
  { key: 'DESTINATION', label: 'Destination', icon: '🎯', fields: [
    F('code', 'Dest code'), F('name', 'Dest name'),
    F('state', 'State', { attr: true }), F('zone', 'Zone', { attr: true }),
    F('serviceType', 'Service type', { attr: true, type: 'select', options: ['REGULAR', 'METRO', 'REMOTE'] }),
    F('country', 'Country', { attr: true }),
  ] },
  { key: 'SALES_EXEC', label: 'Sales Executive', icon: '🧑‍💼', fields: [F('code', 'Code'), F('name', 'Name'), F('commissionPct', 'Commission %', { attr: true, type: 'number' })] },
  { key: 'INDUSTRY', label: 'Industry', icon: '🏭', fields: [F('code', 'Code'), F('name', 'Industry')] },
  { key: 'CONTENT', label: 'Content', icon: '📄', fields: [F('code', 'Code'), F('name', 'Content')] },
  { key: 'INSTRUCTION', label: 'Instruction', icon: '📝', fields: [F('code', 'Code'), F('name', 'Instruction')] },
  { key: 'BANK', label: 'Bank', icon: '🏦', fields: [F('code', 'Code'), F('name', 'Bank name'), F('ifsc', 'IFSC', { attr: true }), F('branch', 'Branch', { attr: true })] },
  { key: 'FLIGHT', label: 'Flight', icon: '✈️', fields: [F('code', 'Flight code'), F('name', 'Flight / carrier'), F('airline', 'Airline', { attr: true })] },
  { key: 'TAX_SETUP', label: 'Tax Setup', icon: '🧮', fields: [
    F('code', 'Entry code'), F('name', 'Label'),
    F('customer', 'Customer', { attr: true }), F('productCode', 'Product', { attr: true }),
    F('fromDate', 'From date', { attr: true }), F('toDate', 'To date', { attr: true }),
    F('igst', 'IGST %', { attr: true, type: 'number' }), F('cgst', 'CGST %', { attr: true, type: 'number' }), F('sgst', 'SGST %', { attr: true, type: 'number' }),
  ] },
];

export function Masters() {
  const [typeKey, setTypeKey] = useState(MASTERS[0].key);
  const def = MASTERS.find((m) => m.key === typeKey)!;
  const [rows, setRows] = useState<any[]>([]);
  const [form, setForm] = useState<Record<string, any>>({});
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [diesel, setDiesel] = useState<number | null>(null);
  const [newDiesel, setNewDiesel] = useState('');
  const saveDiesel = async () => {
    if (!newDiesel) return;
    try { await api.setFuelPrice({ price: Number(newDiesel) }); setDiesel(Number(newDiesel)); setNewDiesel(''); setMsg(`✓ Current diesel set to ₹${newDiesel}/L`); }
    catch (e: any) { setError(e.message); }
  };

  const load = () => api.listMaster(typeKey).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setForm({}); setEditing(false); setError(''); setMsg(''); setQ(''); load(); /* eslint-disable-next-line */ }, [typeKey]);
  useEffect(() => { api.getFuelPrice().then((r) => setDiesel(r.current)).catch(() => {}); }, []);

  // Fuel Mechanism live calculator (effective surcharge % at the current diesel price)
  const fa = form.attrs || {};
  const fmode = String(fa.mode || 'FLAT').toUpperCase();
  const fcap = Number(fa.maxPct) > 0 ? Number(fa.maxPct) : 50;
  const BASE_DIESEL = 98.33; // reference base diesel ₹/L (hardcoded for now; blank field uses this)
  const fref = Number(fa.baseFuelPrice) > 0 ? Number(fa.baseFuelPrice) : BASE_DIESEL;
  // only a RISE above the reference adds; a fall never drops below basePct.
  const frise = Math.max(0, (diesel || 0) - fref);
  const feff = fmode === 'DYNAMIC'
    ? Math.max(0, Math.min(fcap, Number(fa.basePct || 0) + frise * Number(fa.stepPerRupee || 0)))
    : Number(fa.percentage || 0);

  const val = (f: Field) => (f.attr ? form.attrs?.[f.key] ?? '' : form[f.key] ?? '');
  const setVal = (f: Field, v: any) =>
    setForm((prev) => (f.attr ? { ...prev, attrs: { ...(prev.attrs || {}), [f.key]: v } } : { ...prev, [f.key]: v }));

  const editRow = (r: any) => { setForm({ code: r.code, name: r.name, attrs: { ...r.attrs } }); setEditing(true); setShowForm(true); };
  const openAdd = () => { setForm({}); setEditing(false); setError(''); setShowForm(true); };

  const save = async () => {
    setError(''); setMsg('');
    if (!form.code || !form.name) { setError('Code and name are required.'); return; }
    try {
      await api.saveMaster(typeKey, { code: form.code, name: form.name, attrs: form.attrs || {} });
      setMsg(`✓ Saved ${form.code}`); setForm({}); setEditing(false); setShowForm(false); load();
    } catch (e: any) { setError(e.message); }
  };
  const del = async (code: string) => {
    if (!confirm(`Delete ${code}?`)) return;
    try { await api.deleteMaster(typeKey, code); load(); } catch (e: any) { setError(e.message); }
  };

  const [upBusy, setUpBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [impRes, setImpRes] = useState<{ code: string; ok: boolean; error?: string }[]>([]);
  const [impBusy, setImpBusy] = useState(false);

  const uploadProducts = async (f?: File) => {
    if (!f) return; setError(''); setMsg(''); setUpBusy(true);
    try {
      const { parseProductSheet } = await import('../lib/rateSheet');
      const rows = await parseProductSheet(f);
      let ok = 0;
      for (const r of rows) { try { await api.saveMaster('PRODUCT', r); ok++; } catch { /* skip */ } }
      setMsg(`✓ Uploaded ${ok} / ${rows.length} products`); load();
    } catch (e: any) { setError(e.message); } finally { setUpBusy(false); }
  };

  // Generic CSV bulk import for the selected master type (merged from the old Import page).
  const csvCols = () => def.fields.map((f) => f.key).join(',');
  const dlCsvTemplate = () => {
    const url = URL.createObjectURL(new Blob([csvCols() + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `logimart-${typeKey.toLowerCase()}-template.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const runCsvImport = async () => {
    setError(''); setImpRes([]);
    const rows = parseCsv(csvText);
    if (!rows.length) { setError('No rows. Paste CSV (with a header row) or upload a file.'); return; }
    setImpBusy(true);
    const res: { code: string; ok: boolean; error?: string }[] = [];
    for (const r of rows) {
      const { code, name, ...attrs } = r;
      if (!code) continue;
      try { await api.saveMaster(typeKey, { code, name: name || code, attrs }); res.push({ code, ok: true }); }
      catch (e: any) { res.push({ code, ok: false, error: e.message }); }
    }
    setImpRes(res); setImpBusy(false); setCsvText(''); load();
  };

  const attrCols = def.fields.filter((f) => f.attr && f.type !== 'checkbox').slice(0, 3);
  const boolCols = def.fields.filter((f) => f.attr && f.type === 'checkbox').slice(0, 3);
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => !s || r.code.toLowerCase().includes(s) || r.name.toLowerCase().includes(s));

  return (
    <>
      <h1>🗃 Masters</h1>

      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {MASTERS.map((m) => (
            <button key={m.key} className={m.key === typeKey ? '' : 'secondary'} style={{ padding: '8px 14px' }} onClick={() => setTypeKey(m.key)}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 style={{ margin: 0 }}>{def.icon} {def.label}</h2>
            <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>Add one, or bulk-import a CSV. Columns: <code>{csvCols()}</code></p>
            {typeKey === 'CHARGE' && <p className="muted" style={{ fontSize: 12, margin: '4px 0 0', color: 'var(--warn)' }}>Fuel (FSC), FOV, ODA, AWB & other built-in heads live on the <strong>rate card</strong> — don't recreate them here.</p>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={openAdd}>＋ Add {def.label}</button>
            <button className="secondary" onClick={dlCsvTemplate}>⬇ CSV template</button>
            {typeKey === 'PRODUCT' && (
              <label className="secondary" style={{ padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
                ⬆ Product .xlsx<input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} disabled={upBusy} onChange={(e) => uploadProducts(e.target.files?.[0])} />
              </label>
            )}
          </div>
        </div>
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>⬆ Bulk import CSV</summary>
          <div className="row" style={{ marginTop: 10 }}>
            <label className="secondary" style={{ padding: '9px 14px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
              📎 Upload CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setCsvText); }} />
            </label>
          </div>
          <textarea rows={6} value={csvText} onChange={(e) => setCsvText(e.target.value)} placeholder={csvCols() + '\n…'} style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11, marginTop: 10 }} />
          <div className="row" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
            <button onClick={runCsvImport} disabled={impBusy || !csvText.trim()}>{impBusy ? 'Importing…' : `Import into ${def.label}`}</button>
          </div>
          {impRes.length > 0 && <div className="muted" style={{ marginTop: 8 }}>✓ {impRes.filter((r) => r.ok).length}/{impRes.length} imported{impRes.some((r) => !r.ok) ? ` — failed: ${impRes.filter((r) => !r.ok).map((r) => r.code).join(', ')}` : ''}</div>}
        </details>
      </div>

      {typeKey === 'FUEL_MECHANISM' && <AirFuelDefaults onSaved={load} />}

      {showForm && <Modal title={`${editing ? 'Edit' : 'Add'} ${def.label}`} width={760} onClose={() => { setShowForm(false); setEditing(false); setForm({}); }}>
        <div className="grid cols-3">
          {def.fields.map((f) => (
            <div key={f.key}>
              <label>{f.label}{(f.key === 'code' || f.key === 'name') ? ' *' : ''}</label>
              {f.type === 'checkbox' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginTop: 4, cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!!val(f)} onChange={(e) => setVal(f, e.target.checked)} /> Yes
                </label>
              ) : f.type === 'select' ? (
                <select value={val(f)} onChange={(e) => setVal(f, e.target.value)}
                  disabled={typeKey === 'CHARGE' && f.key === 'baseOn' && editing && RESERVED_CHARGE.has(String(form.code).toUpperCase())}>
                  <option value="">—</option>
                  {f.options!.map((o) => <option key={o} value={o}>{typeKey === 'CHARGE' && f.key === 'baseOn' ? baseOnLabel(o) : typeKey === 'FUEL_MECHANISM' && f.key === 'mode' ? fuelModeLabel(o) : o}</option>)}
                </select>
              ) : (
                <input type={f.type === 'number' ? 'number' : 'text'} value={val(f)} disabled={editing && f.key === 'code'} onChange={(e) => setVal(f, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => { setShowForm(false); setEditing(false); setForm({}); }}>Cancel</button>
          <button onClick={save}>{editing ? 'Update' : 'Add'} {def.label}</button>
        </div>

        {typeKey === 'FUEL_MECHANISM' && (
          <div className="card" style={{ borderLeft: '4px solid var(--sky)', marginTop: 16, marginBottom: 0 }}>
            <h2 style={{ marginBottom: 8 }}>🧮 Calculator</h2>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: 12 }}>Current diesel ₹/L</label>
                <input type="number" step="0.01" value={newDiesel} onChange={(e) => setNewDiesel(e.target.value)} placeholder={diesel != null ? String(diesel) : 'e.g. 94.50'} style={{ width: 140 }} />
              </div>
              <button className="secondary" onClick={saveDiesel} disabled={!newDiesel}>Set price</button>
              <span className="muted" style={{ fontSize: 12 }}>In force: <strong>{diesel != null ? `₹${diesel}/L` : 'not set'}</strong> — drives every DYNAMIC card.</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: feff > 60 ? 'var(--warn)' : 'var(--navy)' }}>Effective {fmode === 'DYNAMIC' ? 'diesel surcharge' : 'fuel surcharge'} = {feff.toFixed(2)}%</div>
            {feff > 60 && <div style={{ color: 'var(--warn)', fontWeight: 600, fontSize: 12.5, marginTop: 4 }}>⚠ {feff.toFixed(0)}% is very high — check the % per ₹1 rise and cap.</div>}
            {fmode === 'DYNAMIC' && (
              <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
                {Number(fa.basePct || 0)}% base + max(0, ₹{diesel || 0} − ₹{fref} base) × {Number(fa.stepPerRupee || 0)}%/₹ = <strong>{feff.toFixed(2)}%</strong>
              </p>
            )}
          </div>
        )}
      </Modal>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{def.label} ({rows.length})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 filter" style={{ width: 240 }} />
        </div>
        <table style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Code</th><th>Name</th>
              {attrCols.map((f) => <th key={f.key}>{f.label}</th>)}
              {boolCols.map((f) => <th key={f.key}>{f.label}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 300).map((r) => {
              const isReservedCharge = typeKey === 'CHARGE' && RESERVED_CHARGE.has(String(r.code).toUpperCase());
              return (
              <tr key={r.code}>
                <td><strong>{r.code}</strong>{isReservedCharge && <span title="Built-in charge — the rate here is the DEFAULT; a rate card can override it. Its basis is fixed by billing." style={{ marginLeft: 5 }}>🔧</span>}</td><td>{r.name}</td>
                {attrCols.map((f) => (
                  <td key={f.key}>{
                    typeKey === 'CHARGE' && f.key === 'baseOn'
                      ? (isReservedCharge ? (RESERVED_BASIS[String(r.code).toUpperCase()] ?? baseOnLabel(r.attrs?.baseOn)) : baseOnLabel(r.attrs?.baseOn))
                      : (r.attrs?.[f.key] ?? '—')
                  }</td>
                ))}
                {boolCols.map((f) => <td key={f.key}>{r.attrs?.[f.key] ? '✓' : '—'}</td>)}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="secondary" style={{ padding: '4px 10px', marginRight: 6 }} onClick={() => editRow(r)}>✎</button>
                  <button className="secondary" style={{ padding: '4px 10px' }} onClick={() => del(r.code)}>🗑</button>
                </td>
              </tr>
            ); })}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="muted">No entries yet — add one above.</p>}
      </div>
    </>
  );
}

function splitLine(line: string): string[] {
  const out: string[] = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur); return out;
}
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}
