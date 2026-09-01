import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Client } from '../api';
import { useAuth } from '../auth';
import { useRights } from '../rights';
import { CustomerSubTab } from '../components/CustomerSubTab';
import { Modal } from '../components/Modal';
import { RateCardsDialog } from '../components/RateCardsDialog';

const blank = {
  legalName: '', customerType: 'Domestic', accountCode: '', contactPhone: '',
  contactEmail: '', email2: '', gstin: '', pan: '', tanNo: '', iecCode: '',
  addressLine: '', pincode: '', city: '', state: '', salesPerson: '', salesPersonMobile: '', salesPersonEmail: '',
  csPerson: '', csPersonMobile: '', csPersonEmail: '',
  accountType: 'CREDIT', billingCycle: 'MONTHLY', allowSameGstin: false,
  creditLimit: '', creditDays: '30', isCash: false, canCheckRates: false, canViewInvoices: false, commissionPct: '', parentAccountId: '',
};

const TABS = ['Personal Information', 'Fuel Surcharges', 'Other Charges', 'Customer Volumetric', 'Customer Address'] as const;
type Tab = (typeof TABS)[number];

export function Customers() {
  const { user } = useAuth();
  const isSuper = user?.role === 'SYS_ADMIN';
  const rights = useRights('/customers');
  const [clients, setClients] = useState<Client[]>([]);
  const [form, setForm] = useState({ ...blank });
  const [tab, setTab] = useState<Tab>('Personal Information');
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [hasCards, setHasCards] = useState(false); // customer has ≥1 rate card (kept for reference)
  // Fuel Surcharges / Other Charges / Volumetric now show for ALL customers — vendor-scoped rows override
  // the rate-card charge for that vendor (or add when the card lacks it).
  const showLegacy = !!editing;
  const visibleTabs = TABS.filter((t) => t === 'Personal Information' || t === 'Customer Address' || showLegacy);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // bulk import
  const BULK_COLS = 'accountCode,legalName,gstin,pan,addressLine,city,state,pincode,contactPerson,contactPhone,contactEmail,billingState,customerType,registerType,salesPerson,salesPersonMobile,salesPersonEmail,creditLimit,creditDays,isCash';
  const [bulkText, setBulkText] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ total: number; created: number; results: { name: string; code?: string; ok: boolean; error?: string }[] } | null>(null);
  const [rcClient, setRcClient] = useState<Client | null>(null);

  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const load = () => { api.listClients().then(setClients).catch((e) => setError(e.message)); setSel(new Set()); };
  useEffect(load, []);

  // Configurable customer-code series (super-admin) — CONFIG/CUSTOMER_CODE master { prefix, nextNo, pad }.
  const [codeCfg, setCodeCfg] = useState({ prefix: '', nextNo: '1', pad: '4', active: false });
  const [showCodeCfg, setShowCodeCfg] = useState(false);
  useEffect(() => {
    if (!isSuper) return;
    api.listMaster('CONFIG').then((rows) => {
      const r = rows.find((x) => x.code === 'CUSTOMER_CODE');
      if (r) setCodeCfg({ prefix: String(r.attrs?.prefix ?? ''), nextNo: String(r.attrs?.nextNo ?? '1'), pad: String(r.attrs?.pad ?? '4'), active: r.active !== false });
    }).catch(() => {});
  }, [isSuper]);
  const saveCodeCfg = async () => {
    setError(''); setMsg('');
    const prefix = codeCfg.prefix.trim().toUpperCase();
    const nextNo = Math.max(1, Number(codeCfg.nextNo) || 1);
    const pad = Math.max(1, Math.min(10, Number(codeCfg.pad) || 4));
    try {
      await api.saveMaster('CONFIG', { code: 'CUSTOMER_CODE', name: prefix || 'Customer code series', attrs: { prefix, nextNo, pad }, active: codeCfg.active && !!prefix });
      setMsg(codeCfg.active && prefix ? `Customer codes will now generate as ${prefix}${String(nextNo).padStart(pad, '0')}, ${prefix}${String(nextNo + 1).padStart(pad, '0')}…` : 'Custom code series disabled — codes fall back to name-initials.');
      setShowCodeCfg(false);
    } catch (e: any) { setError(e.message); }
  };

  // Search across code / name / GSTIN / PAN / city / contact.
  const filtered = clients.filter((c) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [c.accountCode, c.legalName, c.gstin, c.pan, c.city, (c as any).contactPhone, (c as any).contactEmail]
      .some((v) => String(v ?? '').toLowerCase().includes(s));
  });

  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = filtered.length > 0 && filtered.every((c) => sel.has(String(c.id)));
  const toggleSelAll = () => setSel(allSelected ? new Set() : new Set(filtered.map((c) => String(c.id))));

  const removeOne = async (c: Client) => {
    const warn = isSuper
      ? `Delete customer ${c.legalName} AND all their shipments, invoices & rate cards? This cannot be undone.`
      : `Delete customer ${c.legalName}? This cannot be undone.`;
    if (!confirm(warn)) return;
    setError(''); setMsg('');
    try { if (isSuper) await api.bulkDeleteCustomers([c.id]); else await api.deleteClient(c.id); setMsg(`Deleted ${c.legalName}.`); load(); }
    catch (e: any) { setError(e.message); }
  };

  const bulkDelete = async () => {
    if (sel.size === 0) return;
    const ids = Array.from(sel);
    const warn = isSuper
      ? `Delete ${ids.length} customer${ids.length > 1 ? 's' : ''} AND all their shipments, invoices & rate cards? This cannot be undone.`
      : `Delete ${ids.length} customer${ids.length > 1 ? 's' : ''}? Customers with shipments/invoices are kept (deactivate those instead).`;
    if (!confirm(warn)) return;
    setError(''); setMsg('');
    try {
      if (isSuper) {
        const r = await api.bulkDeleteCustomers(ids);
        setMsg(`Deleted ${r.deleted} customer${r.deleted !== 1 ? 's' : ''} and all their data.`);
      } else {
        let ok = 0; const failed: string[] = [];
        for (const id of ids) { const c = clients.find((x) => String(x.id) === id); try { await api.deleteClient(id); ok++; } catch { failed.push(c?.legalName ?? id); } }
        setMsg(`Deleted ${ok} customer${ok !== 1 ? 's' : ''}.${failed.length ? ` Kept ${failed.length} with history.` : ''}`);
      }
      load();
    } catch (e: any) { setError(e.message); }
  };

  // Super-admin "start from scratch": wipe ALL customers + shipments (keeps vendors/pincodes/masters/users).
  const wipeAll = async () => {
    if (!confirm('⚠ WIPE ALL customers, shipments and invoices from the LIVE database?\n\nKeeps: vendors, pincodes, masters and login users. Everything else (all customers + all AWBs + rate cards) is permanently deleted.\n\nContinue?')) return;
    if (window.prompt('This cannot be undone. Type WIPE to confirm:') !== 'WIPE') { setMsg('Cancelled — nothing was deleted.'); return; }
    setError(''); setMsg('Wiping…');
    try { const r = await api.resetCustomersShipments(); setMsg(`✓ Wiped ${r.totalDeleted} record(s). Kept: ${r.kept.join(', ')}.`); load(); }
    catch (e: any) { setError(e.message); }
  };

  const bulkTemplate = () => {
    const csv = BULK_COLS + '\nACME001,Acme Traders Pvt Ltd,29ABCDE1234F1Z5,ABCDE1234F,12 MG Road,Bengaluru,Karnataka,560001,Ravi,9900112233,ravi@acme.test,Karnataka,Customer,Registered,Rahul Sharma,9876543210,rahul@excelex.com,500000,30,false\n';
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

  const openEdit = (c: Client) => {
    setEditing(c); setTab('Personal Information'); setError(''); setMsg('');
    setHasCards(false);
    api.listCustomerCards(c.id).then((cs) => setHasCards(Array.isArray(cs) && cs.length > 0)).catch(() => setHasCards(false));
    setForm({
      legalName: c.legalName ?? '', customerType: (c as any).customerType ?? 'Domestic', accountCode: c.accountCode ?? '',
      contactPhone: (c as any).contactPhone ?? '', contactEmail: (c as any).contactEmail ?? '', email2: (c as any).email2 ?? '',
      gstin: (c as any).gstin ?? '', pan: (c as any).pan ?? '', tanNo: (c as any).tanNo ?? '', iecCode: (c as any).iecCode ?? '',
      addressLine: (c as any).addressLine ?? '', pincode: (c as any).pincode ?? '', city: (c as any).city ?? '', state: (c as any).state ?? '',
      salesPerson: (c as any).salesPerson ?? '', salesPersonMobile: (c as any).salesPersonMobile ?? '', salesPersonEmail: (c as any).salesPersonEmail ?? '',
      csPerson: (c as any).csPerson ?? '', csPersonMobile: (c as any).csPersonMobile ?? '', csPersonEmail: (c as any).csPersonEmail ?? '',
      accountType: (c as any).accountType ?? 'CREDIT', billingCycle: (c as any).billingCycle ?? 'MONTHLY',
      allowSameGstin: !!(c as any).allowSameGstin, creditLimit: String((c as any).creditLimit ?? ''), creditDays: String((c as any).creditDays ?? '30'), isCash: !!(c as any).isCash, canCheckRates: !!(c as any).canCheckRates, canViewInvoices: !!(c as any).canViewInvoices, commissionPct: String((c as any).commissionPct ?? ''),
      parentAccountId: (c as any).parentAccountId != null ? String((c as any).parentAccountId) : '',
    });
    setShowAdd(true);
  };

  const save = async () => {
    setError(''); setMsg('');
    const payload = {
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
      salesPersonMobile: form.salesPersonMobile || undefined,
      salesPersonEmail: form.salesPersonEmail || undefined,
      csPerson: form.csPerson || undefined,
      csPersonMobile: form.csPersonMobile || undefined,
      csPersonEmail: form.csPersonEmail || undefined,
      accountType: form.accountType || undefined,
      billingCycle: form.billingCycle || undefined,
      allowSameGstin: form.allowSameGstin,
      canCheckRates: form.canCheckRates,
      canViewInvoices: form.canViewInvoices,
      commissionPct: form.commissionPct ? Number(form.commissionPct) : 0,
      isCash: form.accountType === 'WALLET' ? false : form.isCash,
      creditLimit: form.creditLimit ? +form.creditLimit : 0,
      creditDays: form.creditDays ? +form.creditDays : 30,
      // Parent-account link is only settable on an existing customer (update).
      ...(editing ? { parentAccountId: form.parentAccountId ? +form.parentAccountId : null } : {}),
    };
    try {
      if (editing) {
        const c = await api.updateClient(editing.id, payload) as Client;
        setMsg(`✓ Updated ${c.legalName}`);
      } else {
        const c = await api.createClient(payload) as Client;
        setMsg(`✓ Created ${c.legalName} (${c.accountCode})`);
      }
      setForm({ ...blank }); setEditing(null); setShowAdd(false); load();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <>
      <h1>👥 Customer</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok)' }}>{msg}</div>}

      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 4, gap: 8 }}>
        {isSuper && <button className="secondary" title="Configure the auto-generated customer-code series (prefix + running number)" onClick={() => setShowCodeCfg((v) => !v)}>🔢 Code series</button>}
        {isSuper && <button className="secondary" style={{ color: 'var(--bad, #c0392b)' }} title="Delete ALL customers + shipments (keeps vendors/pincodes/masters)" onClick={wipeAll}>🧹 Wipe all (start fresh)</button>}
        {rights.edit && <button onClick={() => { setEditing(null); setForm({ ...blank }); setTab('Personal Information'); setShowAdd(true); }}>＋ Add Customer</button>}
      </div>

      {isSuper && showCodeCfg && (
        <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>🔢 Customer code series</strong>
            <label className="row" style={{ gap: 6, fontSize: 13, margin: 0 }}><input type="checkbox" checked={codeCfg.active} onChange={(e) => setCodeCfg((c) => ({ ...c, active: e.target.checked }))} /> Use this series</label>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 4 }}>When on, new customer codes auto-generate as <b>Prefix + running number</b> (skipping any code already taken). When off, codes fall back to name-initials + count. Manually-entered codes are always honoured.</p>
          <div className="grid cols-3" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div><label>Prefix</label><input value={codeCfg.prefix} onChange={(e) => setCodeCfg((c) => ({ ...c, prefix: e.target.value.toUpperCase() }))} placeholder="e.g. LMT" /></div>
            <div><label>Next number</label><input type="number" value={codeCfg.nextNo} onChange={(e) => setCodeCfg((c) => ({ ...c, nextNo: e.target.value }))} placeholder="e.g. 1" /></div>
            <div><label>Digits (padding)</label><input type="number" value={codeCfg.pad} onChange={(e) => setCodeCfg((c) => ({ ...c, pad: e.target.value }))} placeholder="e.g. 4" /></div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
            <span className="muted" style={{ fontSize: 12 }}>Next code preview: <b>{(codeCfg.prefix.trim().toUpperCase() || '—')}{String(Math.max(1, Number(codeCfg.nextNo) || 1)).padStart(Math.max(1, Math.min(10, Number(codeCfg.pad) || 4)), '0')}</b></span>
            <button onClick={saveCodeCfg}>Save series</button>
          </div>
        </div>
      )}

      {showAdd && <Modal title="Customer" width={980} onClose={() => setShowAdd(false)}>
        <div className="tabbar">
          {visibleTabs.map((t) => (
            <button key={t} className={'tab' + (t === tab ? ' active' : '') + (t !== 'Personal Information' ? ' soon' : '')} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === 'Personal Information' && (
          <>
            <h2>{editing ? `Edit ${editing.legalName}` : 'Add New Customer'} <span className="muted" style={{ fontSize: 12, fontWeight: 500 }}>— {editing ? 'update this customer' : 'create a new billing entity'}</span></h2>
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
            <div className="grid cols-2" style={{ gap: 12, marginTop: 12 }}>
              <div><label>Sales Person Mobile <span className="muted">(for MIS reports)</span></label><input value={form.salesPersonMobile} onChange={(e) => set('salesPersonMobile', e.target.value)} placeholder="e.g. 9876543210" /></div>
              <div><label>Sales Person Email <span className="muted">(for MIS reports)</span></label><input type="email" value={form.salesPersonEmail} onChange={(e) => set('salesPersonEmail', e.target.value)} placeholder="e.g. rahul@company.com" /></div>
              <div><label>Commission % <span className="muted">(this customer)</span></label><input type="number" value={form.commissionPct} onChange={(e) => set('commissionPct', e.target.value)} placeholder="e.g. 2.5" /></div>
            </div>

            <div style={{ marginTop: 14 }}><label>CS Person <span className="muted">(customer-service owner, optional)</span></label><input value={form.csPerson} onChange={(e) => set('csPerson', e.target.value)} placeholder="e.g. Priya Nair" /></div>
            <div className="grid cols-2" style={{ gap: 12, marginTop: 12 }}>
              <div><label>CS Person Mobile</label><input value={form.csPersonMobile} onChange={(e) => set('csPersonMobile', e.target.value)} placeholder="e.g. 9876543210" /></div>
              <div><label>CS Person Email</label><input type="email" value={form.csPersonEmail} onChange={(e) => set('csPersonEmail', e.target.value)} placeholder="e.g. priya@company.com" /></div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>Account Type</label>
              <div className="row" style={{ gap: 10 }}>
                <button type="button" className={form.accountType === 'CREDIT' ? '' : 'secondary'} onClick={() => set('accountType', 'CREDIT')}>Credit Account<div style={{ fontSize: 11, fontWeight: 400 }}>Post-paid — invoice each cycle</div></button>
                <button type="button" className={form.accountType === 'WALLET' ? '' : 'secondary'} onClick={() => set('accountType', 'WALLET')}>Wallet Account<div style={{ fontSize: 11, fontWeight: 400 }}>Pre-paid — balance deducted</div></button>
                <button type="button" className={form.accountType === 'CARD' ? '' : 'secondary'} onClick={() => set('accountType', 'CARD')}>Card Account<div style={{ fontSize: 11, fontWeight: 400 }}>Paid by card — post-paid</div></button>
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
            <label className="row" style={{ gap: 8, marginTop: 10, fontWeight: 600, color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.canCheckRates} onChange={(e) => setForm((f) => ({ ...f, canCheckRates: e.target.checked }))} />
              Allow rate check in portal <span className="muted" style={{ fontWeight: 400 }}>— customer can estimate shipment costs from their login</span>
            </label>
            <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.canViewInvoices} onChange={(e) => setForm((f) => ({ ...f, canViewInvoices: e.target.checked }))} />
              Show invoices in portal <span className="muted" style={{ fontWeight: 400 }}>— customer can see &amp; download their invoices from their login (#22)</span>
            </label>

            {editing && (
              <div style={{ marginTop: 16 }}>
                <label>Parent account <span className="muted">(group under a head-office account)</span></label>
                <select value={form.parentAccountId} onChange={(e) => set('parentAccountId', e.target.value)}>
                  <option value="">— None (standalone / head office) —</option>
                  {clients
                    .filter((o) => String(o.id) !== String(editing.id) && (o as any).parentAccountId == null)
                    .map((o) => <option key={o.id} value={o.id}>{o.accountCode} — {o.legalName}</option>)}
                </select>
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  A login on any account in the group can book under all of them (parent + children). Only top-level accounts can be a parent.
                </div>
              </div>
            )}

            <div className="row" style={{ marginTop: 18, alignItems: 'center' }}>
              <div><label>Credit limit (₹)</label><input type="number" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} style={{ width: 160 }} /></div>
              <div><label>Credit days</label><input type="number" value={form.creditDays} onChange={(e) => set('creditDays', e.target.value)} style={{ width: 120 }} /></div>
              <button style={{ marginLeft: 'auto' }} disabled={!form.legalName} onClick={save}>{editing ? 'Update Customer' : 'Save Customer'}</button>
            </div>
          </>
        )}

        {tab === 'Fuel Surcharges' && <CustomerSubTab client={editing} kind="fuel" />}
        {tab === 'Other Charges' && <CustomerSubTab client={editing} kind="charges" />}
        {tab === 'Customer Volumetric' && <CustomerSubTab client={editing} kind="vol" />}
        {tab === 'Customer Address' && <CustomerSubTab client={editing} kind="addr" />}
      </Modal>}

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
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <h2 style={{ margin: 0 }}>Customers ({q.trim() ? `${filtered.length} of ${clients.length}` : clients.length})</h2>
          <div style={{ position: 'relative', minWidth: 260 }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 Search name, code, GSTIN, PAN, city…" style={{ width: '100%', padding: '9px 30px 9px 12px' }} />
            {q && <button className="secondary" title="Clear" onClick={() => setQ('')} style={{ position: 'absolute', right: 4, top: 4, padding: '2px 8px', fontSize: 13 }}>✕</button>}
          </div>
        </div>
        {sel.size > 0 && (
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-soft, #f2f4f7)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>
            <span><strong>{sel.size}</strong> selected</span>
            <div className="row" style={{ gap: 8 }}>
              <button className="secondary" style={{ padding: '4px 12px', fontSize: 13 }} onClick={() => setSel(new Set())}>Clear</button>
              {rights.del && <button style={{ padding: '4px 12px', fontSize: 13, background: 'var(--bad)' }} onClick={bulkDelete}>🗑 Delete selected</button>}
            </div>
          </div>
        )}
        <table>
          <thead><tr><th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleSelAll} style={{ width: 'auto' }} /></th><th>Code</th><th>Name</th><th>GSTIN</th><th>PAN</th><th>City</th><th>Credit limit</th><th>Outstanding</th><th>Terms</th><th>Rate Cards</th><th>Status</th><th>Active</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} style={{ opacity: c.isActive === false ? 0.5 : 1, ...(sel.has(String(c.id)) ? { background: 'var(--bg-soft, #f2f4f7)' } : {}) }}>
                <td><input type="checkbox" checked={sel.has(String(c.id))} onChange={() => toggleSel(String(c.id))} style={{ width: 'auto' }} /></td>
                <td>{c.accountCode}</td><td><Link to={`/customers/${c.id}/overview`} title="Open Customer 360"><strong>{c.legalName}</strong></Link></td><td>{c.gstin ?? '—'}</td><td>{c.pan ?? '—'}</td>
                <td>{c.city ?? '—'}</td><td>₹{c.creditLimit}</td><td>₹{c.outstandingBal}</td>
                <td>Net {c.creditDays}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <Link to={`/customers/${c.id}/overview`}><button className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }} title="Customer 360 — full history">📊 360</button></Link>
                  {rights.edit && <button className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }} title="Edit customer" onClick={() => openEdit(c)}>✎ Edit</button>}
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} title="View / edit rate cards" onClick={() => setRcClient(c)}>👁 Cards</button>
                </td>
                <td>{c.isCash ? <span className="badge DOD">CASH</span> : c.isCreditHold ? <span className="badge PARTIAL">HOLD</span> : <span className="badge DELIVERED">OK</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginRight: 6 }} onClick={() => toggleActive(c)}>
                    {c.isActive === false ? 'Activate' : 'Deactivate'}
                  </button>
                  {rights.del && <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} title="Delete customer" onClick={() => removeOne(c)}>🗑</button>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={12} className="muted" style={{ textAlign: 'center', padding: 18 }}>{q.trim() ? `No customers match “${q.trim()}”.` : 'No customers yet.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rcClient && <RateCardsDialog client={rcClient} onClose={() => setRcClient(null)} />}
    </>
  );
}

/** CSV → array of {header: value} rows (first line = header). */
// Quote-aware field split (RFC-4180-ish): commas inside "..." stay in the field,
// so addresses like "Road No 1, Near Air Logic" don't shift every later column.
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; continue; } // escaped ""
      inQ = !inQ; continue;
    }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
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
