import { useEffect, useState } from 'react';
import { api } from '../api';

type Field = { key: string; label: string; type?: 'text' | 'number' | 'select' | 'checkbox'; options?: string[]; attr?: boolean };
type MasterDef = { key: string; label: string; icon: string; fields: Field[] };

const F = (key: string, label: string, extra: Partial<Field> = {}): Field => ({ key, label, type: 'text', ...extra });

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
  { key: 'FUEL_MECHANISM', label: 'Fuel Mechanism', icon: '⛽', fields: [
    F('code', 'Code'), F('name', 'Name'),
    F('mode', 'Mode', { attr: true, type: 'select', options: ['FLAT', 'DYNAMIC'] }),
    F('percentage', 'Flat %  (FLAT)', { attr: true, type: 'number' }),
    F('basePct', 'Base %  (DYNAMIC)', { attr: true, type: 'number' }),
    F('baseFuelPrice', 'Base diesel ₹/L — reference price (DYNAMIC)', { attr: true, type: 'number' }),
    F('stepPerRupee', '% per ₹1 rise  (DYNAMIC)', { attr: true, type: 'number' }),
    F('maxPct', 'Max % cap  (DYNAMIC, default 50)', { attr: true, type: 'number' }),
  ] },
  { key: 'CHARGE', label: 'Charges', icon: '💱', fields: [
    F('code', 'Charge code'), F('name', 'Charge name'),
    F('baseOn', 'Calculated on', { attr: true, type: 'select', options: ['FLAT', 'Actual Weight', 'Freight', 'Shipment Value', 'ODA'] }),
    F('rate', 'Rate', { attr: true, type: 'number' }),
    F('hsn', 'HSN', { attr: true }),
    F('sequence', 'Sequence', { attr: true, type: 'number' }),
    F('applyFuel', 'Apply fuel', { attr: true, type: 'checkbox' }),
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
  { key: 'FUEL_SETUP', label: 'Fuel Setup', icon: '⛽', fields: [
    F('code', 'Entry code'), F('name', 'Label'),
    F('customer', 'Customer', { attr: true }), F('vendor', 'Vendor', { attr: true }), F('productCode', 'Product', { attr: true }),
    F('destination', 'Destination', { attr: true }), F('service', 'Service', { attr: true }),
    F('fromDate', 'From date', { attr: true }), F('toDate', 'To date', { attr: true }),
    F('percentage', 'Fuel %', { attr: true, type: 'number' }),
  ] },
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
  // variable part applies only to the rise ABOVE a reference diesel price; blank/0 ref => no variable
  const frise = Number(fa.baseFuelPrice) > 0 ? (diesel || 0) - Number(fa.baseFuelPrice) : 0;
  const feff = fmode === 'DYNAMIC'
    ? Math.max(0, Math.min(fcap, Number(fa.basePct || 0) + frise * Number(fa.stepPerRupee || 0)))
    : Number(fa.percentage || 0);

  const val = (f: Field) => (f.attr ? form.attrs?.[f.key] ?? '' : form[f.key] ?? '');
  const setVal = (f: Field, v: any) =>
    setForm((prev) => (f.attr ? { ...prev, attrs: { ...(prev.attrs || {}), [f.key]: v } } : { ...prev, [f.key]: v }));

  const editRow = (r: any) => { setForm({ code: r.code, name: r.name, attrs: { ...r.attrs } }); setEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const save = async () => {
    setError(''); setMsg('');
    if (!form.code || !form.name) { setError('Code and name are required.'); return; }
    try {
      await api.saveMaster(typeKey, { code: form.code, name: form.name, attrs: form.attrs || {} });
      setMsg(`✓ Saved ${form.code}`); setForm({}); setEditing(false); load();
    } catch (e: any) { setError(e.message); }
  };
  const del = async (code: string) => {
    if (!confirm(`Delete ${code}?`)) return;
    try { await api.deleteMaster(typeKey, code); load(); } catch (e: any) { setError(e.message); }
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
        <h2>{editing ? `Edit ${def.label}` : `Add ${def.label}`}</h2>
        <div className="grid cols-3">
          {def.fields.map((f) => (
            <div key={f.key}>
              <label>{f.label}{(f.key === 'code' || f.key === 'name') ? ' *' : ''}</label>
              {f.type === 'checkbox' ? (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, marginTop: 4, cursor: 'pointer' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!!val(f)} onChange={(e) => setVal(f, e.target.checked)} /> Yes
                </label>
              ) : f.type === 'select' ? (
                <select value={val(f)} onChange={(e) => setVal(f, e.target.value)}>
                  <option value="">—</option>
                  {f.options!.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input type={f.type === 'number' ? 'number' : 'text'} value={val(f)} disabled={editing && f.key === 'code'} onChange={(e) => setVal(f, e.target.value)} />
              )}
            </div>
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={save}>{editing ? 'Update' : '+ Add'} {def.label}</button>
          {editing && <button className="secondary" onClick={() => { setForm({}); setEditing(false); }}>Cancel</button>}
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
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--navy)' }}>Effective fuel surcharge = {feff.toFixed(2)}%</div>
            {fmode === 'DYNAMIC' && (
              Number(fa.baseFuelPrice) > 0
                ? <p className="muted" style={{ marginTop: 6, marginBottom: 0 }}>
                    {Number(fa.basePct || 0)}% + (₹{diesel || 0} − ₹{Number(fa.baseFuelPrice)} ref) × {Number(fa.stepPerRupee || 0)}/₹ = {feff.toFixed(2)}%
                  </p>
                : <p style={{ marginTop: 6, marginBottom: 0, color: 'var(--warn)', fontWeight: 600 }}>
                    ⚠ Set a <strong>Base diesel ₹/L</strong> (the reference price) — the variable only applies to the rise above it. Until then, effective = base {Number(fa.basePct || 0)}%.
                  </p>
            )}
          </div>
        )}
      </div>

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
            {filtered.slice(0, 300).map((r) => (
              <tr key={r.code}>
                <td><strong>{r.code}</strong></td><td>{r.name}</td>
                {attrCols.map((f) => <td key={f.key}>{r.attrs?.[f.key] ?? '—'}</td>)}
                {boolCols.map((f) => <td key={f.key}>{r.attrs?.[f.key] ? '✓' : '—'}</td>)}
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="secondary" style={{ padding: '4px 10px', marginRight: 6 }} onClick={() => editRow(r)}>✎</button>
                  <button className="secondary" style={{ padding: '4px 10px' }} onClick={() => del(r.code)}>🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <p className="muted">No entries yet — add one above.</p>}
      </div>
    </>
  );
}
