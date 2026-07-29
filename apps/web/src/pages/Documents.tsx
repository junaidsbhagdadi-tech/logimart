import { useEffect, useState } from 'react';
import { api, Client } from '../api';

const DOC_TYPES = ['gst', 'pan', 'agreement', 'kyc', 'insurance', 'rate_contract', 'other'];

export function Documents() {
  const [entityType, setEntityType] = useState<'client' | 'vendor'>('client');
  const [clients, setClients] = useState<Client[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [entityId, setEntityId] = useState('');
  const [docType, setDocType] = useState('agreement');
  const [label, setLabel] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
    api.listVendors().then(setVendors).catch(() => {});
  }, []);

  const loadDocs = (id = entityId) => {
    if (!id) { setDocs([]); return; }
    api.listDocuments(entityType, id).then(setDocs).catch((e) => setError(e.message));
  };
  useEffect(() => { setEntityId(''); setDocs([]); }, [entityType]);

  const upload = async () => {
    setError(''); setMsg('');
    if (!file || !entityId) return;
    try {
      await api.uploadDocument(file, { entityType, entityId, docType, label: label || undefined, expiresAt: expiresAt || undefined });
      setMsg(`Uploaded ${file.name}`);
      setFile(null); setLabel(''); setExpiresAt('');
      loadDocs();
    } catch (e: any) { setError(e.message); }
  };

  const remove = async (id: string) => {
    if (!confirm('Archive this document?')) return;
    try { await api.deleteDocument(id); loadDocs(); } catch (e: any) { setError(e.message); }
  };

  const options = entityType === 'client'
    ? clients.map((c) => ({ id: c.id, label: `${c.legalName} (${c.accountCode})` }))
    : vendors.map((v) => ({ id: v.id, label: v.name }));

  return (
    <>
      <h1>Documents &amp; KYC</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      <div className="card">
        <h2>Upload document</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 13 }}>PDF or image, up to 12 MB. Agreements, GST/PAN copies, insurance, KYC.</p>
        <div className="grid cols-3">
          <div>
            <label>Attach to</label>
            <select value={entityType} onChange={(e) => setEntityType(e.target.value as any)}>
              <option value="client">Customer</option>
              <option value="vendor">Vendor</option>
            </select>
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <label>{entityType === 'client' ? 'Customer' : 'Vendor'} *</label>
            <select value={entityId} onChange={(e) => { setEntityId(e.target.value); loadDocs(e.target.value); }}>
              <option value="">— select —</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label>Document type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((d) => <option key={d} value={d}>{d.replace(/_/g, ' ')}</option>)}
            </select>
          </div>
          <div><label>Label</label><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. FY26 rate agreement" /></div>
          <div><label>Expires on (optional)</label><input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          <div><label>File *</label><input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
        </div>
        <button style={{ marginTop: 12 }} disabled={!file || !entityId} onClick={upload}>Upload</button>
      </div>

      <div className="card">
        <h2>Documents on file</h2>
        {!entityId && <p className="muted">Select a customer or vendor to see their documents.</p>}
        {entityId && (
          <table>
            <thead><tr><th>Type</th><th>Label</th><th>Uploaded</th><th>Expires</th><th></th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><span className="badge">{d.docType}</span></td>
                  <td>{d.label ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{String(d.createdAt).slice(0, 10)}</td>
                  <td>{d.expiresAt ? <span className={d.isExpired ? 'badge EXCEPTION' : ''}>{String(d.expiresAt).slice(0, 10)}</span> : '—'}</td>
                  <td className="row" style={{ gap: 6 }}>
                    <a className="button secondary" href={d.url} target="_blank" rel="noreferrer" style={{ padding: '4px 10px', fontSize: 12 }}>View</a>
                    <button className="secondary" onClick={() => remove(d.id)}>Delete</button>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={5} className="muted">No documents yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
