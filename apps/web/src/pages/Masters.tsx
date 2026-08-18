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

  const load = () => api.listMaster(typeKey).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setForm({}); setEditing(false); setError(''); setMsg(''); setQ(''); load(); /* eslint-disable-next-line */ }, [typeKey]);

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
