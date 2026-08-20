import { useEffect, useState } from 'react';
import { api, Client } from '../api';
import { CustomerSubTab } from '../components/CustomerSubTab';

const blank = {
  legalName: '', accountCode: '', contactPerson: '',
  addressLine: '', addressLine2: '', pincode: '', city: '', state: '',
  tel1: '', tel2: '', contactEmail: '', contactPhone: '', fax: '',
  billingState: '', serviceCentre: '', origin: '', startDate: '',
  gstin: '', aadhaarNo: '', dobAadhaar: '', passportNo: '', pan: '', tanNo: '',
  invoiceFormat: '', customerType: 'Customer', registerType: 'Registered',
  creditLimit: '', creditDays: '30', isOneTime: false, isCash: false,
};

const TABS = ['Personal Information', 'Fuel Surcharges', 'Other Charges', 'Customer Volumetric', 'Customer Address'] as const;
type Tab = (typeof TABS)[number];

export function Customers() {
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [tab, setTab] = useState<Tab>('Personal Information');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // bulk import
  const BULK_COLS = 'accountCode,legalName,gstin,pan,addressLine,city,state,pincode,contactPerson,contactPhone,contactEmail,billingState,customerType,registerType,creditLimit,creditDays,isCash';
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ total: number; created: number; results: { name: string; code?: string; ok: boolean; error?: string }[] } | null>(null);

  const load = () => { api.listClients().then(setClients).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const bulkTemplate = () => {
    const csv = BULK_COLS + '\nACME001,Acme Traders Pvt Ltd,29ABCDE1234F1Z5,ABCDE1234F,12 MG Road,Bengaluru,Karnataka,560001,Ravi,9900112233,ravi@acme.test,Karnataka,Customer,Registered,500000,30,false\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logimart-customers-template.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const bulkImport = async () => {
    setError(''); setBulkResult(null);
    const rows = parseCsv(bulkText);
    if (rows.length === 0) { setError('No rows. Paste CSV (with the header row) or upload a file.'); return; }
    setBulkBusy(true);
    try { setBulkResult(await api.bulkCreateClients(rows)); load(); }
    catch (e: any) { setError(e.message); }
    setBulkBusy(false);
  };

  const set = (k: keyof typeof blank, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const toggleActive = async (c: Client) => {
    setError('');
    try { await api.updateClient(c.id, { isActive: !c.isActive }); load(); }
    catch (e: any) { setError(e.message); }
  };

  const create = async () => {
    setError(''); setMsg('');
    try {
      const c = await api.createClient({
        legalName: form.legalName,
        accountCode: form.accountCode || undefined,
        contactPerson: form.contactPerson || undefined,
        addressLine: form.addressLine || undefined,
        addressLine2: form.addressLine2 || undefined,
        pincode: form.pincode || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        tel1: form.tel1 || undefined,
        tel2: form.tel2 || undefined,
        contactEmail: form.contactEmail || undefined,
        contactPhone: form.contactPhone || undefined,
        fax: form.fax || undefined,
        billingState: form.billingState || undefined,
        serviceCentre: form.serviceCentre || undefined,
        origin: form.origin || undefined,
        startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
        gstin: form.gstin || undefined,
        aadhaarNo: form.aadhaarNo || undefined,
        dobAadhaar: form.dobAadhaar ? new Date(form.dobAadhaar).toISOString() : undefined,
        passportNo: form.passportNo || undefined,
        pan: form.pan || undefined,
        tanNo: form.tanNo || undefined,
        invoiceFormat: form.invoiceFormat || undefined,
        customerType: form.customerType || undefined,
        registerType: form.registerType || undefined,
        creditLimit: form.creditLimit ? +form.creditLimit : 0,
        creditDays: form.creditDays ? +form.creditDays : 30,
        isOneTime: form.isOneTime,
        isCash: form.isCash,
      }) as Client;
      setMsg(`✓ Created ${c.legalName} (${c.accountCode})`);
      setForm({ ...blank });
      load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>👥 Customer</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="card">
        <div className="tabbar">
          {TABS.map((t) => (
            <button key={t} className={'tab' + (t === tab ? ' active' : '') + (t !== 'Personal Information' ? ' soon' : '')} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === 'Personal Information' && (
          <>
            <h2>Personal Details</h2>
            <div className="grid cols-4">
              <div><label>Code</label><input value={form.accountCode} onChange={(e) => set('accountCode', e.target.value.toUpperCase())} placeholder="auto if blank" /></div>
              <div><label>Name *</label><input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} /></div>
              <div><label>Contact Person</label><input value={form.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} /></div>
              <div><label>Address 1</label><input value={form.addressLine} onChange={(e) => set('addressLine', e.target.value)} /></div>

              <div><label>Address 2</label><input value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} /></div>
              <div><label>Pin Code</label><input value={form.pincode} maxLength={6} onChange={(e) => set('pincode', e.target.value)} /></div>
              <div><label>City</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
              <div><label>State</label><input value={form.state} onChange={(e) => set('state', e.target.value)} /></div>

              <div><label>Tel No. 1</label><input value={form.tel1} onChange={(e) => set('tel1', e.target.value)} /></div>
              <div><label>Tel No. 2</label><input value={form.tel2} onChange={(e) => set('tel2', e.target.value)} /></div>
              <div><label>Email ID *</label><input value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="abc@xyz.com" /></div>
              <div><label>Mobile *</label><input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} /></div>

              <div><label>Fax No</label><input value={form.fax} onChange={(e) => set('fax', e.target.value)} /></div>
              <div><label>Customer Billing State *</label><input value={form.billingState} onChange={(e) => set('billingState', e.target.value)} /></div>
              <div><label>Service Centre *</label><input value={form.serviceCentre} onChange={(e) => set('serviceCentre', e.target.value)} /></div>
              <div><label>Start Date *</label><input type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>

              <div><label>Origin *</label><input value={form.origin} onChange={(e) => set('origin', e.target.value)} /></div>
              <div><label>GST No.</label><input value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} /></div>
              <div><label>Aadhar No.</label><input value={form.aadhaarNo} onChange={(e) => set('aadhaarNo', e.target.value)} /></div>
              <div><label>DOB On Aadhar</label><input type="date" value={form.dobAadhaar} onChange={(e) => set('dobAadhaar', e.target.value)} /></div>

              <div><label>Passport No.</label><input value={form.passportNo} onChange={(e) => set('passportNo', e.target.value)} /></div>
              <div><label>PAN No.</label><input value={form.pan} maxLength={10} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="AAAAA0000A" /></div>
              <div><label>TAN No.</label><input value={form.tanNo} onChange={(e) => set('tanNo', e.target.value.toUpperCase())} /></div>
              <div><label>Invoice Format</label><input value={form.invoiceFormat} onChange={(e) => set('invoiceFormat', e.target.value)} /></div>

              <div>
                <label>Customer Type</label>
                <select value={form.customerType} onChange={(e) => set('customerType', e.target.value)}>
                  <option>Customer</option><option>Agent</option><option>Franchise</option>
                </select>
              </div>
              <div>
                <label>Register Type</label>
                <select value={form.registerType} onChange={(e) => set('registerType', e.target.value)}>
                  <option>Registered</option><option>Un Registered</option><option>B2B</option><option>B2C</option>
                </select>
              </div>
              <div><label>Credit limit (₹)</label><input type="number" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} /></div>
              <div><label>Credit days</label><input type="number" value={form.creditDays} onChange={(e) => set('creditDays', e.target.value)} /></div>
            </div>
            <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
              <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}>
                <input type="checkbox" checked={form.isOneTime} onChange={(e) => setForm((f) => ({ ...f, isOneTime: e.target.checked }))} style={{ width: 'auto' }} /> One-time / walk-in customer
              </label>
              <label className="row" style={{ gap: 6, fontWeight: 600, color: 'var(--text)' }}>
                <input type="checkbox" checked={form.isCash} onChange={(e) => setForm((f) => ({ ...f, isCash: e.target.checked }))} style={{ width: 'auto' }} /> Cash customer (no invoices)
              </label>
              <button style={{ marginLeft: 'auto' }} disabled={!form.legalName} onClick={create}>Save</button>
            </div>
          </>
        )}

        {tab === 'Fuel Surcharges' && <CustomerSubTab clients={clients} kind="fuel" />}
        {tab === 'Other Charges' && <CustomerSubTab clients={clients} kind="charges" />}
        {tab === 'Customer Volumetric' && <CustomerSubTab clients={clients} kind="vol" />}
        {tab === 'Customer Address' && <CustomerSubTab clients={clients} kind="addr" />}
      </div>

      <div className="card">
        <h2>⬆ Bulk import customers (CSV)</h2>
        <p className="muted" style={{ marginTop: -6 }}>One customer per row. Columns: <code>{BULK_COLS}</code>. First row is the header; <code>legalName</code> is required, code auto-generates if blank.</p>
        <div className="row">
          <button className="secondary" onClick={bulkTemplate}>⬇ Template</button>
          <label className="secondary" style={{ padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            📎 Upload CSV<input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(setBulkText); }} />
          </label>
        </div>
        <textarea rows={6} value={bulkText} onChange={(e) => setBulkText(e.target.value)} placeholder={BULK_COLS + '\n…'} style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11, marginTop: 12 }} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted"><strong>{parseCsv(bulkText).length}</strong> row(s){bulkResult && <span style={{ marginLeft: 12, color: 'var(--ok)', fontWeight: 700 }}>✓ {bulkResult.created}/{bulkResult.total} created</span>}</div>
          <button onClick={bulkImport} disabled={bulkBusy || parseCsv(bulkText).length === 0}>{bulkBusy ? 'Importing…' : `Import ${parseCsv(bulkText).length} customer(s)`}</button>
        </div>
        {bulkResult && bulkResult.results.some((r) => !r.ok) && (
          <table style={{ marginTop: 12 }}>
            <thead><tr><th>Customer</th><th>Status</th></tr></thead>
            <tbody>{bulkResult.results.filter((r) => !r.ok).map((r, i) => <tr key={i}><td>{r.name}</td><td><span className="badge EXCEPTION">{r.error}</span></td></tr>)}</tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Customers ({clients.length})</h2>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>PAN</th><th>City</th><th>Credit limit</th><th>Outstanding</th><th>Terms</th><th>Status</th><th>Active</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive === false ? 0.5 : 1 }}>
                <td>{c.accountCode}</td><td><strong>{c.legalName}</strong></td><td>{c.gstin ?? '—'}</td><td>{c.pan ?? '—'}</td>
                <td>{c.city ?? '—'}</td><td>₹{c.creditLimit}</td><td>₹{c.outstandingBal}</td>
                <td>Net {c.creditDays}</td>
                <td>{c.isCash ? <span className="badge DOD">CASH</span> : c.isCreditHold ? <span className="badge PARTIAL">HOLD</span> : <span className="badge DELIVERED">OK</span>}</td>
                <td>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => toggleActive(c)}>
                    {c.isActive === false ? 'Activate' : 'Deactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** CSV → array of {header: value} rows (first line = header). */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}
