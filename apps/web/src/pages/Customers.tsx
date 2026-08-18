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
  creditLimit: '', creditDays: '30', isOneTime: false,
};

const TABS = ['Personal Information', 'Fuel Surcharges', 'Other Charges', 'Customer Volumetric', 'Customer Address'] as const;
type Tab = (typeof TABS)[number];

export function Customers() {
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [tab, setTab] = useState<Tab>('Personal Information');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = () => { api.listClients().then(setClients).catch((e) => setError(e.message)); };
  useEffect(load, []);

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
        <h2>Customers ({clients.length})</h2>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>GSTIN</th><th>PAN</th><th>City</th><th>Credit limit</th><th>Outstanding</th><th>Terms</th><th>Status</th><th>Active</th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive === false ? 0.5 : 1 }}>
                <td>{c.accountCode}</td><td><strong>{c.legalName}</strong></td><td>{c.gstin ?? '—'}</td><td>{c.pan ?? '—'}</td>
                <td>{c.city ?? '—'}</td><td>₹{c.creditLimit}</td><td>₹{c.outstandingBal}</td>
                <td>Net {c.creditDays}</td>
                <td>{c.isCreditHold ? <span className="badge PARTIAL">HOLD</span> : <span className="badge DELIVERED">OK</span>}</td>
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
