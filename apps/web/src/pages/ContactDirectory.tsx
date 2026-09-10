import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';

type Row = { id: string; vendorId: string; vendorName: string; vendorCode: string; location: string; product: string | null; personName: string; phone: string | null; email: string | null; role: string | null };

// Flexible column pick — works with our template AND a Gmail-contacts CSV export.
const pick = (r: Record<string, any>, keys: string[]) => {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const map: Record<string, any> = {};
  for (const k of Object.keys(r)) map[norm(k)] = r[k];
  for (const k of keys) { const v = map[norm(k)]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
  return '';
};

export function ContactDirectory() {
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState('');
  const [vendors, setVendors] = useState<{ id: string; name: string; vendorCode: string }[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ vendorId: '', location: '', product: '', personName: '', phone: '', email: '', role: '' });
  const [busy, setBusy] = useState(false);
  const [upResult, setUpResult] = useState<{ total: number; created: number; results: { ok: boolean; personName?: string; error?: string }[] } | null>(null);

  const load = (search?: string) => api.contactDirectory(search).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { api.listVendors().then((v: any[]) => setVendors(v.filter((x) => x.isActive !== false).map((x) => ({ id: String(x.id), name: x.name, vendorCode: x.vendorCode })))).catch(() => {}); }, []);
  useEffect(() => { const t = setTimeout(() => load(q.trim() || undefined), 300); return () => clearTimeout(t); }, [q]);

  const grouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { const k = `${r.vendorName || r.vendorCode} · ${r.location}`; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
    return [...m.entries()];
  }, [rows]);

  const save = async () => {
    if (!form.vendorId || !form.location.trim() || !form.personName.trim()) { setError('Vendor, location and person name are required.'); return; }
    setError(''); setMsg('');
    try {
      await api.addVendorContact(form.vendorId, { location: form.location, product: form.product || undefined, personName: form.personName, phone: form.phone || undefined, email: form.email || undefined, role: form.role || undefined });
      setMsg(`✓ Added ${form.personName}`); setAdding(false); setForm({ vendorId: '', location: '', product: '', personName: '', phone: '', email: '', role: '' }); load(q.trim() || undefined);
    } catch (e: any) { setError(e.message); }
  };

  const del = async (r: Row) => { if (!confirm(`Remove ${r.personName} (${r.vendorName} · ${r.location})?`)) return; try { await api.deleteVendorContact(r.id); load(q.trim() || undefined); } catch (e: any) { setError(e.message); } };

  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(''); setMsg(''); setUpResult(null); setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const mapped = raw.map((r) => ({
        vendor: pick(r, ['vendor', 'vendorCode', 'vendorName', 'carrier', 'company', 'organization', 'organization name']),
        location: pick(r, ['location', 'branch', 'city', 'servicecentre', 'servicecenter']),
        product: pick(r, ['product', 'service']),
        personName: pick(r, ['personName', 'name', 'contact', 'contactperson', 'fullname']),
        phone: pick(r, ['phone', 'mobile', 'phone1value', 'phone 1 - value', 'phonenumber', 'contactno']),
        email: pick(r, ['email', 'e-mail 1 - value', 'email1value', 'mail']),
        role: pick(r, ['role', 'designation', 'title', 'department']),
      })).filter((r) => r.personName && (r.vendor || r.location));
      if (!mapped.length) { setError('No usable rows found. Need at least vendor + location + a person name.'); setBusy(false); return; }
      const r = await api.bulkContacts(mapped);
      setUpResult(r); setMsg(`✓ Imported ${r.created} / ${r.total} contacts`); load(q.trim() || undefined);
    } catch (e: any) { setError('Import failed: ' + e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>📇 Contact Directory <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>— vendor · location · product</span></h1>
      <p className="muted" style={{ marginTop: -8 }}>Ops / carrier contacts for the CS team — multiple people per location. Search by vendor, location, product, name or number.</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)', fontWeight: 600 }}>{msg}</div>}

      <div className="card">
        <div className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 vendor / location / product / name / number…" style={{ flex: '1 1 300px', minWidth: 240 }} />
          <button onClick={() => { setForm({ vendorId: '', location: '', product: '', personName: '', phone: '', email: '', role: '' }); setAdding(true); setError(''); }}>＋ Add contact</button>
          <label className="secondary" style={{ padding: '9px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            {busy ? 'Importing…' : '⬆ Import CSV / Excel'}
            <input type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }} disabled={busy} onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.currentTarget.value = ''; }} />
          </label>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Import columns (any order, flexible names): <code>vendor · location · product · personName · phone · email · role</code>. A Gmail-contacts CSV export also works (Name / Phone / E-mail map automatically) — set the vendor &amp; location columns.</p>
      </div>

      {upResult && upResult.results.some((r) => !r.ok) && (
        <div className="card"><h3 style={{ marginTop: 0 }}>Import — {upResult.created}/{upResult.total} added</h3>
          <table><thead><tr><th>Person</th><th>Error</th></tr></thead><tbody>
            {upResult.results.filter((r) => !r.ok).slice(0, 50).map((r, i) => <tr key={i}><td>{r.personName ?? '—'}</td><td className="muted">{r.error}</td></tr>)}
          </tbody></table>
        </div>
      )}

      <div className="card" style={{ overflowX: 'auto' }}>
        {rows.length === 0 ? <p className="muted">No contacts{q ? ' match' : ' yet — add one or import a file'}.</p> : grouped.map(([head, list]) => (
          <div key={head} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: 13, padding: '4px 0', borderBottom: '2px solid var(--border)' }}>{head} <span className="muted" style={{ fontWeight: 400 }}>· {list.length}</span></div>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Person</th><th>Role</th><th>Product</th><th>Phone</th><th>Email</th><th></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.personName}</strong></td>
                    <td>{r.role ?? '—'}</td>
                    <td>{r.product ?? '—'}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone}`}>{r.phone}</a> : '—'}</td>
                    <td>{r.email ? <a href={`mailto:${r.email}`}>{r.email}</a> : '—'}</td>
                    <td><button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => del(r)}>🗑</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {adding && (
        <Modal title="Add contact" width={620} onClose={() => setAdding(false)}>
          <div className="grid cols-2" style={{ gap: 12 }}>
            <div><label>Vendor *</label>
              <select value={form.vendorId} onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value }))}>
                <option value="">— select —</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.vendorCode ? `${v.vendorCode} — ` : ''}{v.name}</option>)}
              </select>
            </div>
            <div><label>Location *</label><input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="e.g. AHMEDABAD" /></div>
            <div><label>Product</label><input value={form.product} onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))} placeholder="optional (APEX / SFC …)" /></div>
            <div><label>Person name *</label><input value={form.personName} onChange={(e) => setForm((f) => ({ ...f, personName: e.target.value }))} /></div>
            <div><label>Phone</label><input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
            <div><label>Email</label><input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            <div><label>Role</label><input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} placeholder="e.g. Branch Manager / Ops" /></div>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button className="secondary" onClick={() => setAdding(false)}>Cancel</button>
            <button onClick={save}>Save contact</button>
          </div>
        </Modal>
      )}
    </>
  );
}
