import { useEffect, useState } from 'react';
import { api, Client } from '../api';
import { CustomerSubTab } from '../components/CustomerSubTab';
import { RateCardsDialog } from '../components/RateCardsDialog';

const blank = {
  legalName: '', customerType: 'Domestic', accountCode: '', contactPhone: '',
  contactEmail: '', email2: '', gstin: '', pan: '', tanNo: '', iecCode: '',
  addressLine: '', pincode: '', city: '', state: '', salesPerson: '',
  accountType: 'CREDIT', billingCycle: 'MONTHLY', allowSameGstin: false,
  creditLimit: '', creditDays: '30', isCash: false,
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
  const [rcClient, setRcClient] = useState<Client | null>(null);

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

  const set = (k: keyof typeof blank, v: any) => setForm((f) => ({ ...f, [k]: v }));

  // auto-fill city + state from the pincode master (billing-app behaviour)
  const onPincode = (v: string) => {
    setForm((f) => ({ ...f, pincode: v }));
    if (/^\d{6}$/.test(v)) api.lookupPincode(v).then((p) => { if (p?.city) setForm((f) => ({ ...f, city: p.city!, state: p.state ?? f.state })); }).catch(() => {});
  };

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
        customerType: form.customerType || undefined,
        accountCode: form.accountCode || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        email2: form.email2 || undefined,
        gstin: form.gstin || undefined,
        pan: form.pan || undefined,
        tanNo: form.tanNo || undefined,
        iecCode: form.iecCode || undefined,
        addressLine: form.addressLine || undefined,
        pincode: form.pincode || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        salesPerson: form.salesPerson || undefined,
        accountType: form.accountType || undefined,
        billingCycle: form.billingCycle || undefined,
        allowSameGstin: form.allowSameGstin,
        isCash: form.accountType === 'WALLET' ? false : form.isCash,
        creditLimit: form.creditLimit ? +form.creditLimit : 0,
        creditDays: form.creditDays ? +form.creditDays : 30,
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
            <h2>Add New Customer <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>— create a new billing entity</span></h2>
            <div className="grid cols-2">
              <div><label>Customer Name *</label><input value={form.legalName} onChange={(e) => set('legalName', e.target.value)} placeholder="Acme Logistics Pvt Ltd" /></div>
              <div>
                <label>Customer Type *</label>
                <select value={form.customerType} onChange={(e) => set('customerType', e.target.value)}>
                  <option>Domestic</option><option>International</option>
                </select>
              </div>

              <div><label>Account Code <span className="muted">(optional)</span></label><input value={form.accountCode} onChange={(e) => set('accountCode', e.target.value.toUpperCase())} placeholder="auto if blank" /></div>
              <div><label>Contact No *</label><input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+91 98765 43210" /></div>

              <div><label>Primary Email * <span className="muted">(for invoices)</span></label><input value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="billing@company.com" /></div>
              <div><label>Secondary Email <span className="muted">(CC)</span></label><input value={form.email2} onChange={(e) => set('email2', e.target.value)} placeholder="accounts@company.com" /></div>

              <div><label>GSTIN *</label><input value={form.gstin} maxLength={15} onChange={(e) => set('gstin', e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" /></div>
              <div><label>PAN <span className="muted">(optional)</span></label><input value={form.pan} maxLength={10} onChange={(e) => set('pan', e.target.value.toUpperCase())} placeholder="ABCDE1234F" /></div>

              <div><label>TAN <span className="muted">(optional)</span></label><input value={form.tanNo} onChange={(e) => set('tanNo', e.target.value.toUpperCase())} /></div>
              <div><label>IEC Code <span className="muted">(optional)</span></label><input value={form.iecCode} onChange={(e) => set('iecCode', e.target.value)} /></div>
            </div>

            <div style={{ marginTop: 14 }}><label>Billing Address *</label><input value={form.addressLine} onChange={(e) => set('addressLine', e.target.value)} placeholder="123 Industrial Area, Phase 1" /></div>
            <div className="grid cols-3" style={{ marginTop: 14 }}>
              <div><label>Pincode *</label><input value={form.pincode} maxLength={6} onChange={(e) => onPincode(e.target.value)} placeholder="400001" /><div className="muted" style={{ fontSize: 11, marginTop: 3 }}>City &amp; State auto-fill on entry</div></div>
              <div><label>City *</label><input value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
              <div><label>State *</label><input value={form.state} onChange={(e) => set('state', e.target.value)} /></div>
            </div>

            <div style={{ marginTop: 14 }}><label>Sales Person <span className="muted">(optional)</span></label><input value={form.salesPerson} onChange={(e) => set('salesPerson', e.target.value)} placeholder="e.g. Rahul Sharma" /></div>

            <div style={{ marginTop: 16 }}>
              <label>Account Type</label>
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className={form.accountType === 'CREDIT' ? '' : 'secondary'} onClick={() => set('accountType', 'CREDIT')}>Credit Account<div style={{ fontSize: 11, fontWeight: 400 }}>Post-paid — invoice each cycle</div></button>
                <button type="button" className={form.accountType === 'WALLET' ? '' : 'secondary'} onClick={() => set('accountType', 'WALLET')}>Wallet Account<div style={{ fontSize: 11, fontWeight: 400 }}>Pre-paid — balance deducted</div></button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>Billing Cycle</label>
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className={form.billingCycle === 'MONTHLY' ? '' : 'secondary'} onClick={() => set('billingCycle', 'MONTHLY')}>Monthly (1st–30/31st)</button>
                <button type="button" className={form.billingCycle === 'FORTNIGHTLY' ? '' : 'secondary'} onClick={() => set('billingCycle', 'FORTNIGHTLY')}>Fortnightly (1–15 / 16–End)</button>
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Determines valid billing date ranges.</div>
            </div>

            <label className="row" style={{ gap: 8, marginTop: 16, fontWeight: 600, color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.allowSameGstin} onChange={(e) => setForm((f) => ({ ...f, allowSameGstin: e.target.checked }))} />
              Allow duplicate GSTIN <span className="muted" style={{ fontWeight: 400 }}>— create a second billing account for the same legal entity</span>
            </label>

            <div className="row" style={{ marginTop: 18, alignItems: 'center' }}>
              <div><label>Credit limit (₹)</label><input type="number" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} style={{ width: 160 }} /></div>
              <div><label>Credit days</label><input type="number" value={form.creditDays} onChange={(e) => set('creditDays', e.target.value)} style={{ width: 120 }} /></div>
              <button style={{ marginLeft: 'auto' }} disabled={!form.legalName} onClick={create}>Save Customer</button>
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
          <thead><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>PAN</th><th>City</th><th>Credit limit</th><th>Outstanding</th><th>Terms</th><th>Rate Cards</th><th>Status</th><th>Active</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive === false ? 0.5 : 1 }}>
                <td>{c.accountCode}</td><td><strong>{c.legalName}</strong></td><td>{c.gstin ?? '—'}</td><td>{c.pan ?? '—'}</td>
                <td>{c.city ?? '—'}</td><td>₹{c.creditLimit}</td><td>₹{c.outstandingBal}</td>
                <td>Net {c.creditDays}</td>
                <td><button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} title="View / edit rate cards" onClick={() => setRcClient(c)}>👁 Cards</button></td>
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
      {rcClient && <RateCardsDialog client={rcClient} onClose={() => setRcClient(null)} />}
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
