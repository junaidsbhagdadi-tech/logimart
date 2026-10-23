import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Billing legal entities (multi-company). Each company is a MasterEntry type=COMPANY keyed by its
 * Service-Centre code. A customer's "Billing company" (serviceCentre) points here; invoices are raised
 * under the matched entity's name/GST/address/bank and its own invoice-number series.
 */
type Company = {
  code: string; name: string; active: boolean;
  attrs: {
    legalName?: string; gstin?: string; pan?: string; cin?: string; stateCode?: string;
    addressLines?: string[]; phones?: string; email?: string; sacCode?: string; jurisdiction?: string;
    invoicePrefix?: string; invoicePad?: number; invoiceNextNo?: number; isDefault?: boolean;
    bank?: { beneficiary?: string; name?: string; accountNo?: string; ifsc?: string; branch?: string; address?: string };
    terms?: string[];
    logo?: string;      // data URL — printed on the invoice header
    signature?: string; // data URL — stamp + authorised signature, printed at the invoice foot
  };
};

/** Read an image file and downscale it (max 600px, PNG keeps a stamp's transparency) to a small data URL. */
function imageToDataUrl(file: File, max = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Not a readable image (use PNG or JPG).'));
    img.src = URL.createObjectURL(file);
  });
}

const blank = {
  code: '', legalName: '', gstin: '', pan: '', cin: '', stateCode: '', branch: '',
  addressLines: '', phones: '', email: '', sacCode: '996812', jurisdiction: '',
  invoicePrefix: '', invoicePad: '5', invoiceNextNo: '1', isDefault: false, active: true,
  bankBeneficiary: '', bankName: '', bankAccountNo: '', bankIfsc: '', bankBranch: '', bankAddress: '',
  terms: '', logo: '', signature: '',
};

export function Companies() {
  const [rows, setRows] = useState<Company[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [editing, setEditing] = useState<string | null>(null);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const set = (k: keyof typeof form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const load = () => { api.listMaster('COMPANY').then((r) => setRows(r as any)).catch((e) => setErr(e.message)); };
  useEffect(load, []);

  const openNew = () => { setEditing(null); setForm({ ...blank }); setShow(true); setErr(''); setMsg(''); };
  const openEdit = (c: Company) => {
    const a = c.attrs || {};
    setEditing(c.code);
    setForm({
      code: c.code, legalName: a.legalName ?? c.name ?? '', gstin: a.gstin ?? '', pan: a.pan ?? '', cin: a.cin ?? '',
      stateCode: a.stateCode ?? '', branch: '', addressLines: (a.addressLines ?? []).join('\n'), phones: a.phones ?? '',
      email: a.email ?? '', sacCode: a.sacCode ?? '996812', jurisdiction: a.jurisdiction ?? '',
      invoicePrefix: a.invoicePrefix ?? '', invoicePad: String(a.invoicePad ?? 5), invoiceNextNo: String(a.invoiceNextNo ?? 1),
      isDefault: !!a.isDefault, active: c.active !== false,
      bankBeneficiary: a.bank?.beneficiary ?? '', bankName: a.bank?.name ?? '', bankAccountNo: a.bank?.accountNo ?? '',
      bankIfsc: a.bank?.ifsc ?? '', bankBranch: a.bank?.branch ?? '', bankAddress: a.bank?.address ?? '',
      terms: (a.terms ?? []).join('\n'), logo: a.logo ?? '', signature: a.signature ?? '',
    });
    setShow(true); setErr(''); setMsg('');
  };

  const save = async () => {
    setErr(''); setMsg('');
    if (!form.code.trim()) { setErr('Service-Centre code is required (e.g. BOM, DEL).'); return; }
    if (!form.legalName.trim()) { setErr('Legal name is required.'); return; }
    const attrs: Company['attrs'] = {
      legalName: form.legalName.trim(),
      gstin: form.gstin.trim() || undefined,
      pan: form.pan.trim() || undefined,
      cin: form.cin.trim() || undefined,
      stateCode: form.stateCode.trim() || (form.gstin.trim().length >= 2 ? form.gstin.trim().slice(0, 2) : undefined),
      addressLines: form.addressLines.split('\n').map((l) => l.trim()).filter(Boolean),
      phones: form.phones.trim() || undefined,
      email: form.email.trim() || undefined,
      sacCode: form.sacCode.trim() || undefined,
      jurisdiction: form.jurisdiction.trim() || undefined,
      invoicePrefix: form.invoicePrefix.trim() || undefined,
      invoicePad: Number(form.invoicePad) || 5,
      invoiceNextNo: Math.max(1, Number(form.invoiceNextNo) || 1),
      isDefault: form.isDefault,
      bank: (form.bankName || form.bankAccountNo || form.bankIfsc) ? {
        beneficiary: form.bankBeneficiary.trim() || form.legalName.trim(),
        name: form.bankName.trim(), accountNo: form.bankAccountNo.trim(), ifsc: form.bankIfsc.trim(),
        branch: form.bankBranch.trim(), address: form.bankAddress.trim() || undefined,
      } : undefined,
      terms: form.terms.split('\n').map((l) => l.trim()).filter(Boolean),
      logo: form.logo || undefined,
      signature: form.signature || undefined,
    };
    if (!attrs.terms?.length) delete attrs.terms;
    try {
      // Only one default entity — clear the flag on the others when this one is set default.
      if (form.isDefault) {
        for (const r of rows) {
          if (r.code !== form.code.trim() && (r.attrs as any)?.isDefault) {
            await api.saveMaster('COMPANY', { code: r.code, name: r.name, attrs: { ...r.attrs, isDefault: false }, active: r.active });
          }
        }
      }
      await api.saveMaster('COMPANY', { code: form.code.trim().toUpperCase(), name: form.legalName.trim(), attrs, active: form.active });
      setMsg(`✓ Saved ${form.legalName}`); setShow(false); setEditing(null); load();
    } catch (e: any) { setErr(e.message); }
  };

  const remove = async (code: string) => {
    if (!confirm(`Delete billing company "${code}"? Customers pointing here will fall back to the default entity. (Existing invoices keep their snapshot.)`)) return;
    try { await api.deleteMaster('COMPANY', code); load(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <>
      <h1>🏢 Billing Companies</h1>
      <p className="muted" style={{ marginTop: -6 }}>Legal entities that raise invoices. A customer's <strong>Billing company</strong> (Service Centre) selects one; each has its own GST identity, bank and invoice-number series.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>{rows.length} compan{rows.length === 1 ? 'y' : 'ies'}</strong>
          <button onClick={openNew}>＋ Add company</button>
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ fontSize: 13 }}>
            <thead><tr><th>Code</th><th>Legal name</th><th>GSTIN</th><th>State</th><th>Inv. series</th><th>Default</th><th>Active</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.code}>
                  <td><strong>{c.code}</strong></td>
                  <td>{c.attrs?.legalName ?? c.name}</td>
                  <td>{c.attrs?.gstin || <span className="muted">— not set —</span>}</td>
                  <td>{c.attrs?.stateCode ?? '—'}</td>
                  <td>{c.attrs?.invoicePrefix ? `${c.attrs.invoicePrefix}… (next ${c.attrs.invoiceNextNo ?? 1})` : <span className="muted">global</span>}</td>
                  <td>{c.attrs?.isDefault ? '★' : ''}</td>
                  <td>{c.active !== false ? '✓' : <span className="muted">off</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, marginRight: 6 }} onClick={() => openEdit(c)}>✎ Edit</button>
                    <button className="secondary" style={{ padding: '3px 8px', fontSize: 12, color: 'var(--danger, #c0392b)' }} onClick={() => remove(c.code)}>🗑</button>
                  </td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="muted">No billing companies yet. Add one per legal entity you invoice from.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <div className="card">
          <h2>{editing ? `Edit ${editing}` : 'New billing company'}</h2>
          <div className="grid cols-4" style={{ gap: 12 }}>
            <div><label>Service-Centre code *</label><input value={form.code} disabled={!!editing} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="BOM / DEL / VEL" /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Legal name *</label><input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="LOGIMART TECHNOLOGIES PVT LTD" /></div>
            <div><label>GSTIN</label><input value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="27AAAAA0000A1Z5" /></div>
            <div><label>PAN</label><input value={form.pan} onChange={(e) => set('pan', e.target.value.toUpperCase())} /></div>
            <div><label>CIN</label><input value={form.cin} onChange={(e) => set('cin', e.target.value)} /></div>
            <div><label>State code <span className="muted" style={{ fontSize: 11 }}>(GST — auto from GSTIN)</span></label><input value={form.stateCode} onChange={(e) => set('stateCode', e.target.value)} placeholder="27" /></div>
            <div><label>Jurisdiction</label><input value={form.jurisdiction} onChange={(e) => set('jurisdiction', e.target.value)} placeholder="Mumbai" /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Address (one line per row)</label><textarea value={form.addressLines} onChange={(e) => set('addressLines', e.target.value)} rows={2} placeholder={'Unit 5, ABC Industrial Estate,\nAndheri East, Mumbai - 400069'} /></div>
            <div><label>Phone(s)</label><input value={form.phones} onChange={(e) => set('phones', e.target.value)} /></div>
            <div><label>Email</label><input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
            <div><label>HSN/SAC</label><input value={form.sacCode} onChange={(e) => set('sacCode', e.target.value)} /></div>
          </div>

          <h3 style={{ marginBottom: 6 }}>Invoice number series</h3>
          <div className="grid cols-4" style={{ gap: 12 }}>
            <div><label>Prefix <span className="muted" style={{ fontSize: 11 }}>(blank = use global)</span></label><input value={form.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} placeholder="LGM/25-26/" /></div>
            <div><label>Pad (digits)</label><input type="number" value={form.invoicePad} onChange={(e) => set('invoicePad', e.target.value)} /></div>
            <div><label>Next number</label><input type="number" value={form.invoiceNextNo} onChange={(e) => set('invoiceNextNo', e.target.value)} /></div>
            <div style={{ alignSelf: 'end' }} className="muted">Next invoice: <strong>{form.invoicePrefix}{String(Math.max(1, Number(form.invoiceNextNo) || 1)).padStart(Math.max(1, Number(form.invoicePad) || 5), '0')}</strong></div>
          </div>

          <h3 style={{ marginBottom: 6 }}>Bank (invoice footer)</h3>
          <div className="grid cols-4" style={{ gap: 12 }}>
            <div style={{ gridColumn: 'span 2' }}><label>Beneficiary</label><input value={form.bankBeneficiary} onChange={(e) => set('bankBeneficiary', e.target.value)} placeholder="(defaults to legal name)" /></div>
            <div><label>Bank</label><input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} /></div>
            <div><label>A/C No.</label><input value={form.bankAccountNo} onChange={(e) => set('bankAccountNo', e.target.value)} /></div>
            <div><label>IFSC</label><input value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value)} /></div>
            <div><label>Branch</label><input value={form.bankBranch} onChange={(e) => set('bankBranch', e.target.value)} /></div>
            <div style={{ gridColumn: 'span 2' }}><label>Bank address</label><input value={form.bankAddress} onChange={(e) => set('bankAddress', e.target.value)} /></div>
          </div>

          <h3 style={{ marginBottom: 6 }}>Invoice look</h3>
          <div className="grid cols-4" style={{ gap: 12 }}>
            {([['logo', 'Company logo', 'Printed at the top of the invoice'], ['signature', 'Stamp & signature', 'Printed above "Authorised Signatory"']] as const).map(([k, label, hint]) => (
              <div key={k}>
                <label>{label} <span className="muted" style={{ fontSize: 11 }}>({hint})</span></label>
                {form[k]
                  ? <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <img src={form[k]} alt="" style={{ maxHeight: 64, maxWidth: 160, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }} />
                      <button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => set(k, '')}>Remove</button>
                    </div>
                  : <input type="file" accept="image/png,image/jpeg" onChange={async (e) => {
                      const f = e.target.files?.[0]; if (!f) return;
                      try { set(k, await imageToDataUrl(f)); } catch (er: any) { setErr(er.message); }
                    }} />}
              </div>
            ))}
            <div style={{ gridColumn: 'span 2' }}>
              <label>Terms &amp; conditions <span className="muted" style={{ fontSize: 11 }}>(one per line — blank = standard terms with this company's name)</span></label>
              <textarea value={form.terms} onChange={(e) => set('terms', e.target.value)} rows={4} placeholder={`Cheque / Draft should be made in favour of "${form.legalName || 'COMPANY NAME'}".`} />
            </div>
          </div>

          <div className="row" style={{ gap: 18, marginTop: 14, alignItems: 'center' }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.isDefault} onChange={(e) => set('isDefault', e.target.checked)} /> Default entity <span className="muted" style={{ fontSize: 11 }}>(bills customers with no company set)</span></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> Active</label>
            <div style={{ flex: 1 }} />
            <button className="secondary" onClick={() => { setShow(false); setEditing(null); }}>Cancel</button>
            <button onClick={save}>💾 Save company</button>
          </div>
        </div>
      )}
    </>
  );
}
