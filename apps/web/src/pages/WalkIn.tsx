import { useEffect, useMemo, useState } from 'react';
import { api, Client } from '../api';
import { COMPANY } from '../company';

const money = (v: any) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

const BLANK = {
  // shipper
  senderName: '', senderPhone: '', senderMobile: '', senderGstin: '', senderAddr1: '', senderAddr2: '', senderPincode: '', senderCity: '', senderState: '',
  // consignee
  consigneeName: '', consigneePhone: '', consigneeGstin: '', consigneeAddr: '', consigneePincode: '', consigneeCity: '', consigneeState: '',
  // shipment
  product: '', originHubId: '', destHubId: '', deadKg: '', pieces: '1', lengthCm: '', widthCm: '', heightCm: '',
  declaredValue: '', shipmentValue: '', goodsDesc: '', agreedFreight: '',
};

/** Counter / walk-in quick-book with full booking fields (shipper/consignee address + GSTIN,
 *  goods/value, dimensions), rate-card or agreed freight, cash/wallet payment + receipt. */
export function WalkIn() {
  const [pay, setPay] = useState<'CASH' | 'WALLET'>('CASH');
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string; attrs: any }[]>([]);
  const [hubs, setHubs] = useState<any[]>([]);
  const [walletClientId, setWalletClientId] = useState('');
  const [wallet, setWallet] = useState<{ walletBalance: number } | null>(null);
  const [topup, setTopup] = useState('');

  const [form, setForm] = useState({ ...BLANK });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [receipt, setReceipt] = useState<any>(null);

  useEffect(() => {
    api.listClients().then(setClients).catch(() => {});
    api.listMaster('PRODUCT').then((r) => setProducts(r as any)).catch(() => {});
    api.listHubs().then((h) => { setHubs(h); setForm((f) => ({ ...f, originHubId: f.originHubId || String(h[0]?.id ?? ''), destHubId: f.destHubId || String(h[1]?.id ?? h[0]?.id ?? '') })); }).catch(() => {});
  }, []);

  const walletCustomers = useMemo(() => clients.filter((c: any) => String(c.accountType).toUpperCase() === 'WALLET'), [clients]);
  const loadWallet = (id: string) => { setWalletClientId(id); if (id) api.getWallet(id).then(setWallet).catch(() => setWallet(null)); else setWallet(null); };
  const doTopup = async () => {
    if (!walletClientId || !topup) return;
    try { const r = await api.walletTopup(walletClientId, Number(topup)); setWallet({ walletBalance: r.walletBalance }); setTopup(''); } catch (e: any) { setErr(e.message); }
  };

  // pincode → city/state auto-fill
  const fillPin = async (pincode: string, which: 'sender' | 'consignee') => {
    if (!/^\d{6}$/.test(pincode)) return;
    try {
      const p: any = await api.lookupPincode(pincode);
      if (p?.city || p?.state) setForm((f) => which === 'sender'
        ? { ...f, senderCity: p.city ?? f.senderCity, senderState: p.state ?? f.senderState }
        : { ...f, consigneeCity: p.city ?? f.consigneeCity, consigneeState: p.state ?? f.consigneeState });
    } catch { /* unknown pincode */ }
  };

  const serviceModeFor = (code: string) => {
    const g = String(products.find((p) => p.code === code)?.attrs?.groupType || '').toUpperCase();
    return g.includes('AIR') ? 'AIR_ECONOMY' : g.includes('TRAIN') ? 'RAIL' : 'ROAD_PTL';
  };

  const book = async () => {
    setErr(''); setReceipt(null);
    if (!form.product) { setErr('Pick a product.'); return; }
    if (!form.deadKg) { setErr('Enter weight.'); return; }
    if (pay === 'WALLET' && !walletClientId) { setErr('Select a wallet customer.'); return; }
    // "As Agreed" (or any non-numeric text) = freight negotiated, no amount keyed / collected.
    const af = String(form.agreedFreight || '').trim();
    const afNum = Number(af);
    const isAgreed = af !== '' && isNaN(afNum);
    setBusy(true);
    try {
      const clientId = pay === 'WALLET' ? Number(walletClientId) : Number((await api.ensureWalkin()).id);
      const originHub = hubs.find((h) => String(h.id) === form.originHubId);
      const nPcs = Math.max(1, Number(form.pieces) || 1);
      const dims = (form.lengthCm && form.widthCm && form.heightCm)
        ? { lengthCm: Number(form.lengthCm), widthCm: Number(form.widthCm), heightCm: Number(form.heightCm) } : {};
      const created: any = await api.createShipment({
        clientId, serviceMode: serviceModeFor(form.product), originHubId: Number(form.originHubId), destHubId: Number(form.destHubId),
        originZone: originHub?.zone || 'NORTH', destZone: 'AUTO', product: form.product, destPincode: form.consigneePincode || undefined,
        // shipper
        shipperName: form.senderName || undefined, shipperPhone: form.senderPhone || undefined, shipperMobile: form.senderMobile || form.senderPhone || undefined,
        shipperGstin: form.senderGstin || undefined, shipperAddress1: form.senderAddr1 || undefined, shipperAddress2: form.senderAddr2 || undefined,
        shipperPincode: form.senderPincode || undefined, shipperCity: form.senderCity || undefined, shipperState: form.senderState || undefined,
        // consignee
        consigneeName: form.consigneeName || undefined, consigneePhone: form.consigneePhone || undefined, consigneeGstin: form.consigneeGstin || undefined,
        consigneeAddress: form.consigneeAddr || undefined, consigneeCity: form.consigneeCity || undefined, consigneeState: form.consigneeState || undefined,
        // consignment
        goodsDesc: form.goodsDesc || undefined, declaredValue: form.declaredValue ? Number(form.declaredValue) : undefined, shipmentValue: form.shipmentValue ? Number(form.shipmentValue) : undefined,
        consignorGstin: form.senderGstin || undefined,
        manualFreight: (!isAgreed && af !== '') ? afNum : undefined,
        referenceNo: isAgreed ? `Freight: ${af}` : undefined,
        pieces: Array.from({ length: nPcs }, () => ({ deadKg: Number(form.deadKg) / nPcs, ...dims })),
      });
      const awb = created.awb;
      const receiptBase = {
        awb, product: form.product, sender: form.senderName, senderGstin: form.senderGstin,
        consignee: form.consigneeName, consigneeGstin: form.consigneeGstin, destPincode: form.consigneePincode,
        destCity: form.consigneeCity, deadKg: form.deadKg, pieces: form.pieces, at: new Date().toLocaleString('en-IN'),
      };
      // "As Agreed" → booked, no amount keyed, no payment taken.
      if (isAgreed) {
        setReceipt({ ...receiptBase, agreedText: af, method: 'AS AGREED', amount: null, customer: pay === 'WALLET' ? (clients.find((c) => String(c.id) === walletClientId) as any)?.legalName : 'Walk-in (Cash)' });
        setForm((f) => ({ ...BLANK, originHubId: f.originHubId, destHubId: f.destHubId }));
        setBusy(false); return;
      }
      let amount = af !== '' ? afNum : 0;
      let quote: any = null;
      if (!amount) { try { quote = await api.rateQuote(awb); amount = quote.grandTotal; } catch { /* no rate */ } }
      if (!amount) { setErr(`Booked ${awb}, but no rate found — enter an Agreed freight (₹ or “As Agreed”) and re-book, or collect manually.`); setBusy(false); return; }
      const paid = await api.payAtBooking(awb, amount, pay);
      if (pay === 'WALLET') setWallet({ walletBalance: paid.walletBalance ?? 0 });
      setReceipt({ ...receiptBase, amount, method: pay, customer: paid.customer, quote, walletBalance: paid.walletBalance });
      setForm((f) => ({ ...BLANK, originHubId: f.originHubId, destHubId: f.destHubId }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const Fld = ({ label, k, ph, type }: { label: string; k: string; ph?: string; type?: string }) => (
    <div><label>{label}</label><input type={type || 'text'} value={(form as any)[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} /></div>
  );

  return (
    <>
      <h1>🧾 Walk-in Counter</h1>
      <p className="muted" style={{ marginTop: -14 }}>Quick-book a counter shipment (full shipper/consignee details), take cash or wallet payment, print a receipt.</p>
      {err && <div className="error">{err}</div>}

      {/* payment mode */}
      <div className="card">
        <div className="row" style={{ gap: 8 }}>
          <button className={pay === 'CASH' ? '' : 'secondary'} onClick={() => setPay('CASH')}>💵 Cash</button>
          <button className={pay === 'WALLET' ? '' : 'secondary'} onClick={() => setPay('WALLET')}>👛 Wallet</button>
        </div>
        {pay === 'WALLET' && (
          <div className="card" style={{ padding: 12, marginTop: 10, background: 'var(--bg-soft, #f2f4f7)' }}>
            <div className="grid cols-3" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div>
                <label>Wallet customer</label>
                <select value={walletClientId} onChange={(e) => loadWallet(e.target.value)}>
                  <option value="">Select</option>
                  {walletCustomers.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
                </select>
              </div>
              <div><label>Balance</label><div style={{ fontSize: 20, fontWeight: 800 }}>{wallet ? money(wallet.walletBalance) : '—'}</div></div>
              <div className="row" style={{ gap: 6 }}><input type="number" value={topup} onChange={(e) => setTopup(e.target.value)} placeholder="top-up ₹" style={{ width: 110 }} /><button className="secondary" onClick={doTopup} disabled={!walletClientId || !topup}>＋ Top up</button></div>
            </div>
            {!walletCustomers.length && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>No Wallet customers — set a customer's Account Type to “Wallet” on the Customers screen.</p>}
          </div>
        )}
      </div>

      {/* shipper */}
      <div className="card">
        <h2>📤 Shipper</h2>
        <div className="grid cols-3">
          <Fld label="Name" k="senderName" ph="sender name" /><Fld label="Phone" k="senderPhone" /><Fld label="Mobile" k="senderMobile" />
          <Fld label="GSTIN" k="senderGstin" ph="29ABCDE1234F1Z5" />
          <div style={{ gridColumn: 'span 2' }}><label>Address</label><input value={form.senderAddr1} onChange={(e) => set('senderAddr1', e.target.value)} placeholder="address line 1" /></div>
          <div><label>Pincode</label><input value={form.senderPincode} onChange={(e) => set('senderPincode', e.target.value)} onBlur={(e) => fillPin(e.target.value, 'sender')} /></div>
          <Fld label="City" k="senderCity" /><Fld label="State" k="senderState" />
        </div>
      </div>

      {/* consignee */}
      <div className="card">
        <h2>📥 Consignee</h2>
        <div className="grid cols-3">
          <Fld label="Name" k="consigneeName" /><Fld label="Phone" k="consigneePhone" /><Fld label="GSTIN" k="consigneeGstin" ph="opt." />
          <div style={{ gridColumn: 'span 2' }}><label>Address</label><input value={form.consigneeAddr} onChange={(e) => set('consigneeAddr', e.target.value)} placeholder="delivery address" /></div>
          <div><label>Dest pincode <span className="muted">(resolves zone)</span></label><input value={form.consigneePincode} onChange={(e) => set('consigneePincode', e.target.value)} onBlur={(e) => fillPin(e.target.value, 'consignee')} /></div>
          <Fld label="City" k="consigneeCity" /><Fld label="State" k="consigneeState" />
        </div>
      </div>

      {/* shipment */}
      <div className="card">
        <h2>📦 Shipment</h2>
        <div className="grid cols-3">
          <div><label>Product *</label>
            <select value={form.product} onChange={(e) => set('product', e.target.value)}><option value="">Select</option>{products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select>
          </div>
          <div><label>Origin hub</label><select value={form.originHubId} onChange={(e) => set('originHubId', e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.code}</option>)}</select></div>
          <div><label>Dest hub</label><select value={form.destHubId} onChange={(e) => set('destHubId', e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.code}</option>)}</select></div>
          <Fld label="Weight (kg) *" k="deadKg" type="number" /><Fld label="Pieces" k="pieces" type="number" />
          <div className="grid cols-3" style={{ gap: 6 }}>
            <div><label>L cm</label><input type="number" value={form.lengthCm} onChange={(e) => set('lengthCm', e.target.value)} /></div>
            <div><label>W cm</label><input type="number" value={form.widthCm} onChange={(e) => set('widthCm', e.target.value)} /></div>
            <div><label>H cm</label><input type="number" value={form.heightCm} onChange={(e) => set('heightCm', e.target.value)} /></div>
          </div>
          <Fld label="Invoice / shipment value ₹" k="shipmentValue" type="number" /><Fld label="Declared value ₹" k="declaredValue" type="number" />
          <div style={{ gridColumn: 'span 1' }}><label>Goods description</label><input value={form.goodsDesc} onChange={(e) => set('goodsDesc', e.target.value)} /></div>
          <div>
            <label>Agreed freight <span className="muted">(₹ amount, blank = rate card, or “As Agreed”)</span></label>
            <input value={form.agreedFreight} onChange={(e) => set('agreedFreight', e.target.value)} placeholder='amount or "As Agreed"' />
          </div>
        </div>
        <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={book} disabled={busy}>{busy ? 'Booking…' : `Book & take ${pay === 'WALLET' ? 'wallet' : 'cash'} payment`}</button>
        </div>
      </div>

      {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
    </>
  );
}

function Receipt({ r, onClose }: { r: any; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ width: 430, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div id="receipt" style={{ fontSize: 13 }}>
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #999', paddingBottom: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{COMPANY.legalName}</div>
            <div className="muted" style={{ fontSize: 11 }}>{COMPANY.addressLines?.[0]}</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>CASH / COUNTER RECEIPT</div>
          </div>
          <table style={{ width: '100%', fontSize: 12.5 }}><tbody>
            <tr><td className="muted">AWB</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{r.awb}</td></tr>
            <tr><td className="muted">Date</td><td style={{ textAlign: 'right' }}>{r.at}</td></tr>
            <tr><td className="muted">Shipper</td><td style={{ textAlign: 'right' }}>{r.sender || '—'}{r.senderGstin ? ` (${r.senderGstin})` : ''}</td></tr>
            <tr><td className="muted">Consignee</td><td style={{ textAlign: 'right' }}>{r.consignee || '—'}{r.consigneeGstin ? ` (${r.consigneeGstin})` : ''}</td></tr>
            <tr><td className="muted">Destination</td><td style={{ textAlign: 'right' }}>{r.destCity || ''} {r.destPincode || ''}</td></tr>
            <tr><td className="muted">Product · Wt · Pcs</td><td style={{ textAlign: 'right' }}>{r.product} · {r.deadKg}kg · {r.pieces}</td></tr>
          </tbody></table>
          {r.quote && (
            <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderTop: '1px dashed #999', paddingTop: 4 }}><tbody>
              {r.quote.lines?.map((l: any, i: number) => <tr key={i}><td className="muted">{l.head}</td><td style={{ textAlign: 'right' }}>{money(l.amount)}</td></tr>)}
              <tr><td className="muted">GST</td><td style={{ textAlign: 'right' }}>{money(r.quote.gst)}</td></tr>
            </tbody></table>
          )}
          <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}>
            {r.amount == null
              ? <><span>FREIGHT</span><span>{r.agreedText || 'As Agreed'}</span></>
              : <><span>PAID ({r.method})</span><span>{money(r.amount)}</span></>}
          </div>
          {r.method === 'WALLET' && r.walletBalance != null && <div className="muted" style={{ textAlign: 'right', fontSize: 12, marginTop: 2 }}>Wallet balance: {money(r.walletBalance)}</div>}
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11 }} className="muted">Thank you!</div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <a href={`/shipments/${r.awb}/awb-print`} target="_blank" rel="noreferrer"><button className="secondary">🖨 Print AWB</button></a>
          <button className="secondary" onClick={() => window.print()}>🖨 Receipt</button>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
