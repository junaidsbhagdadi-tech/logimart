import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/Modal';

// Legacy old-system data archive — SUPER ADMIN ONLY. Small files stored inline (≤25 MB);
// large zips should be linked (Drive/Spaces URL).
const CATEGORIES = ['Invoices', 'PODs', 'Manifests', 'Ledgers', 'Other'];
const MAX_INLINE = 25 * 1024 * 1024;
const blank = { title: '', category: 'Invoices', fiscalYear: '', note: '', fileUrl: '' };
const fmtSize = (b?: number | null) => (b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function Archive() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.listArchive>>>([]);
  const [form, setForm] = useState({ ...blank });
  const [file, setFile] = useState<File | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => api.listArchive().then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const fileToDataUrl = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error('read failed')); r.readAsDataURL(f); });

  const create = async () => {
    setError(''); setMsg('');
    if (!form.title.trim()) { setError('Title is required.'); return; }
    if (!file && !form.fileUrl.trim()) { setError('Attach a file or paste an external link.'); return; }
    if (file && file.size > MAX_INLINE) { setError('File over 25 MB — upload it to Drive/Spaces and paste the link instead.'); return; }
    setBusy(true);
    try {
      const body: any = { title: form.title.trim(), category: form.category, fiscalYear: form.fiscalYear || null, note: form.note || null, fileUrl: form.fileUrl || null };
      if (file) { body.fileData = await fileToDataUrl(file); body.fileName = file.name; body.mimeType = file.type; body.sizeBytes = file.size; }
      await api.createArchive(body);
      setMsg('✓ Archived'); setForm({ ...blank }); setFile(null); setShowAdd(false); load();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const download = async (id: string, name?: string | null) => {
    try {
      const f = await api.archiveFile(id);
      if (f.fileUrl) { window.open(f.fileUrl, '_blank'); return; }
      if (!f.fileData) { setError('No file bytes stored.'); return; }
      const a = document.createElement('a'); a.href = f.fileData; a.download = name || 'archive'; a.click();
    } catch (e: any) { setError(e.message); }
  };
  const del = async (id: string) => { if (!confirm('Delete this archived item permanently?')) return; try { await api.deleteArchive(id); load(); } catch (e: any) { setError(e.message); } };

  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => !s || r.title.toLowerCase().includes(s) || String(r.category).toLowerCase().includes(s) || String(r.fiscalYear).toLowerCase().includes(s));

  return (
    <>
      <h1>🗄 Archive <span className="muted" style={{ fontSize: 13, fontWeight: 500 }}>— legacy old-system data (super admin)</span></h1>
      <p className="muted" style={{ marginTop: -14 }}>Store old invoices / PODs / ledgers (PDF or ZIP). Files ≤ 25 MB are kept inline; for large archives paste an external link (Drive / Spaces).</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 4 }}>
        <button onClick={() => { setForm({ ...blank }); setFile(null); setShowAdd(true); }}>＋ Add to Archive</button>
      </div>

      {showAdd && <Modal title="Add to Archive" width={640} onClose={() => setShowAdd(false)}>
        <div className="grid cols-2">
          <div><label>Title *</label><input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="FY22-23 Invoices (Q1)" /></div>
          <div><label>Category</label><select value={form.category} onChange={(e) => set('category', e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Fiscal year</label><input value={form.fiscalYear} onChange={(e) => set('fiscalYear', e.target.value)} placeholder="2022-23" /></div>
          <div><label>Note</label><input value={form.note} onChange={(e) => set('note', e.target.value)} placeholder="source / contents" /></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <label>File (PDF / ZIP / image · ≤ 25 MB)</label>
          <input type="file" accept=".pdf,.zip,.jpg,.jpeg,.png,application/pdf,application/zip" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          {file && <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>📎 {file.name} · {fmtSize(file.size)}</span>}
        </div>
        <div style={{ marginTop: 10 }}>
          <label>…or external link <span className="muted">(for large archives)</span></label>
          <input value={form.fileUrl} onChange={(e) => set('fileUrl', e.target.value)} placeholder="https://drive.google.com/…" />
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button className="secondary" onClick={() => setShowAdd(false)}>Cancel</button>
          <button onClick={create} disabled={busy}>{busy ? 'Saving…' : 'Archive'}</button>
        </div>
      </Modal>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Archived items ({rows.length})</h2>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 title / category / year" style={{ width: 260 }} />
        </div>
        <table style={{ marginTop: 12 }}>
          <thead><tr><th>Title</th><th>Category</th><th>FY</th><th>File</th><th>Size</th><th>Added</th><th></th></tr></thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.title}</strong>{r.note && <div className="muted" style={{ fontSize: 11 }}>{r.note}</div>}</td>
                <td>{r.category ?? '—'}</td>
                <td>{r.fiscalYear ?? '—'}</td>
                <td>{r.fileUrl ? '🔗 link' : r.fileName ? `📎 ${r.fileName}` : '—'}</td>
                <td>{r.fileUrl ? '—' : fmtSize(r.sizeBytes) || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleDateString('en-IN')}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="secondary" style={{ padding: '3px 9px', fontSize: 12, marginRight: 6 }} onClick={() => download(r.id, r.fileName)}>⬇ Open</button>
                  <button className="secondary" style={{ padding: '3px 9px', fontSize: 12 }} onClick={() => del(r.id)}>🗑</button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={7} className="muted">Nothing archived yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
