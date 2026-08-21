import { useEffect, useMemo, useState } from 'react';
import { api, Client } from '../api';
import { COMPANY } from '../company';

const money = (v: any) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`;

/** Counter / walk-in quick-book: book against the cash walk-in customer (or a wallet
 *  customer), price via rate card or agreed freight, take payment, print a receipt. */
export function WalkIn() {
  const [pay, setPay] = useState<'CASH' | 'WALLET'>('CASH');
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<{ code: string; name: string; attrs: any }[]>([]);
  const [hubs, setHubs] = useState<any[]>([]);
  const [walletClientId, setWalletClientId] = useState('');
  const [wallet, setWallet] = useState<{ walletBalance: number } | null>(null);
  const [topup, setTopup] = useState('');

  const [form, setForm] = useState({
    senderName: '', senderPhone: '', consigneeName: '', consigneePhone: '', destPincode: '',
    product: '', originHubId: '', destHubId: '', deadKg: '', pieces: '1', agreedFreight: '',
  });
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

  const serviceModeFor = (code: string) => {
    const g = String(products.find((p) => p.code === code)?.attrs?.groupType || '').toUpperCase();
    return g.includes('AIR') ? 'AIR_ECONOMY' : g.includes('TRAIN') ? 'RAIL' : 'ROAD_PTL';
  };

  const book = async () => {
    setErr(''); setReceipt(null);
    if (!form.product) { setErr('Pick a product.'); return; }
    if (!form.deadKg) { setErr('Enter weight.'); return; }
    if (pay === 'WALLET' && !walletClientId) { setErr('Select a wallet customer.'); return; }
    setBusy(true);
    try {
      const clientId = pay === 'WALLET' ? Number(walletClientId) : Number((await api.ensureWalkin()).id);
      const originHub = hubs.find((h) => String(h.id) === form.originHubId);
      const created: any = await api.createShipment({
        clientId, serviceMode: serviceModeFor(form.product), originHubId: Number(form.originHubId), destHubId: Number(form.destHubId),
        originZone: originHub?.zone || 'NORTH', destZone: 'AUTO', product: form.product, destPincode: form.destPincode || undefined,
        shipperName: form.senderName || undefined, shipperMobile: form.senderPhone || undefined,
        consigneeName: form.consigneeName || undefined, consigneePhone: form.consigneePhone || undefined,
        manualFreight: form.agreedFreight ? Number(form.agreedFreight) : undefined,
        pieces: Array.from({ length: Math.max(1, Number(form.pieces) || 1) }, () => ({ deadKg: Number(form.deadKg) / Math.max(1, Number(form.pieces) || 1) })),
      });
      const awb = created.awb;
      // amount = agreed freight, else the live quote
      let amount = form.agreedFreight ? Number(form.agreedFreight) : 0;
      let quote: any = null;
      if (!amount) { try { quote = await api.rateQuote(awb); amount = quote.grandTotal; } catch { /* no rate → needs agreed freight */ } }
      if (!amount) { setErr(`Booked ${awb}, but no rate found — enter an Agreed freight and re-book, or collect manually.`); setBusy(false); return; }
      const paid = await api.payAtBooking(awb, amount, pay);
      if (pay === 'WALLET') setWallet({ walletBalance: paid.walletBalance ?? 0 });
      setReceipt({ awb, amount, method: pay, customer: paid.customer, quote, product: form.product,
        sender: form.senderName, consignee: form.consigneeName, destPincode: form.destPincode, deadKg: form.deadKg, pieces: form.pieces,
        walletBalance: paid.walletBalance, at: new Date().toLocaleString('en-IN') });
      setForm((f) => ({ ...f, senderName: '', senderPhone: '', consigneeName: '', consigneePhone: '', destPincode: '', deadKg: '', pieces: '1', agreedFreight: '' }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <>
      <h1>🧾 Walk-in Counter</h1>
      <p className="muted" style={{ marginTop: -14 }}>Quick-book a counter shipment, take cash or wallet payment, and print a receipt.</p>
      {err && <div className="error">{err}</div>}

      <div className="card">
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <button className={pay === 'CASH' ? '' : 'secondary'} onClick={() => setPay('CASH')}>💵 Cash</button>
          <button className={pay === 'WALLET' ? '' : 'secondary'} onClick={() => setPay('WALLET')}>👛 Wallet</button>
        </div>

        {pay === 'WALLET' && (
          <div className="card" style={{ padding: 12, background: 'var(--bg-soft, #f2f4f7)' }}>
            <div className="grid cols-3" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div>
                <label>Wallet customer</label>
                <select value={walletClientId} onChange={(e) => loadWallet(e.target.value)}>
                  <option value="">Select</option>
                  {walletCustomers.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}
                </select>
              </div>
              <div><label>Balance</label><div style={{ fontSize: 20, fontWeight: 800 }}>{wallet ? money(wallet.walletBalance) : '—'}</div></div>
              <div className="row" style={{ gap: 6 }}>
                <input type="number" value={topup} onChange={(e) => setTopup(e.target.value)} placeholder="top-up ₹" style={{ width: 110 }} />
                <button className="secondary" onClick={doTopup} disabled={!walletClientId || !topup}>＋ Top up</button>
              </div>
            </div>
            {!walletCustomers.length && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>No Wallet customers yet — set a customer's Account Type to “Wallet” on the Customers screen.</p>}
          </div>
        )}

        <div className="grid cols-3" style={{ gap: 12, marginTop: 12 }}>
          <div><label>Sender name</label><input value={form.senderName} onChange={(e) => set('senderName', e.target.value)} placeholder="walk-in sender" /></div>
          <div><label>Sender phone</label><input value={form.senderPhone} onChange={(e) => set('senderPhone', e.target.value)} /></div>
          <div><label>Product *</label>
            <select value={form.product} onChange={(e) => set('product', e.target.value)}>
              <option value="">Select</option>
              {products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}
            </select>
          </div>
          <div><label>Consignee name</label><input value={form.consigneeName} onChange={(e) => set('consigneeName', e.target.value)} /></div>
          <div><label>Consignee phone</label><input value={form.consigneePhone} onChange={(e) => set('consigneePhone', e.target.value)} /></div>
          <div><label>Dest pincode</label><input value={form.destPincode} onChange={(e) => set('destPincode', e.target.value)} placeholder="resolves zone" /></div>
          <div><label>Origin hub</label>
            <select value={form.originHubId} onChange={(e) => set('originHubId', e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.code}</option>)}</select>
          </div>
          <div><label>Dest hub</label>
            <select value={form.destHubId} onChange={(e) => set('destHubId', e.target.value)}>{hubs.map((h) => <option key={h.id} value={h.id}>{h.code}</option>)}</select>
          </div>
          <div className="grid cols-2" style={{ gap: 8 }}>
            <div><label>Weight (kg) *</label><input type="number" step="0.001" value={form.deadKg} onChange={(e) => set('deadKg', e.target.value)} /></div>
            <div><label>Pieces</label><input type="number" value={form.pieces} onChange={(e) => set('pieces', e.target.value)} /></div>
          </div>
          <div><label>Agreed freight ₹ <span className="muted">(optional — overrides rate)</span></label><input type="number" value={form.agreedFreight} onChange={(e) => set('agreedFreight', e.target.value)} placeholder="use rate card if blank" /></div>
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
      <div className="modal-card" style={{ width: 420, maxWidth: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div id="receipt" style={{ fontSize: 13 }}>
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #999', paddingBottom: 8, marginBottom: 8 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>{COMPANY.legalName}</div>
            <div className="muted" style={{ fontSize: 11 }}>{COMPANY.addressLines?.[0]}</div>
            <div style={{ fontWeight: 700, marginTop: 4 }}>CASH / COUNTER RECEIPT</div>
          </div>
          <table style={{ width: '100%', fontSize: 12.5 }}><tbody>
            <tr><td className="muted">AWB</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{r.awb}</td></tr>
            <tr><td className="muted">Date</td><td style={{ textAlign: 'right' }}>{r.at}</td></tr>
            <tr><td className="muted">Customer</td><td style={{ textAlign: 'right' }}>{r.customer}</td></tr>
            <tr><td className="muted">Sender → Consignee</td><td style={{ textAlign: 'right' }}>{r.sender || '—'} → {r.consignee || '—'}</td></tr>
            <tr><td className="muted">Dest pincode</td><td style={{ textAlign: 'right' }}>{r.destPincode || '—'}</td></tr>
            <tr><td className="muted">Product · Wt · Pcs</td><td style={{ textAlign: 'right' }}>{r.product} · {r.deadKg}kg · {r.pieces}</td></tr>
          </tbody></table>
          {r.quote && (
            <table style={{ width: '100%', fontSize: 12, marginTop: 8, borderTop: '1px dashed #999', paddingTop: 4 }}><tbody>
              {r.quote.lines?.map((l: any, i: number) => <tr key={i}><td className="muted">{l.head}</td><td style={{ textAlign: 'right' }}>{money(l.amount)}</td></tr>)}
              <tr><td className="muted">GST</td><td style={{ textAlign: 'right' }}>{money(r.quote.gst)}</td></tr>
            </tbody></table>
          )}
          <div style={{ borderTop: '1px solid #333', marginTop: 8, paddingTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 15 }}>
            <span>PAID ({r.method})</span><span>{money(r.amount)}</span>
          </div>
          {r.method === 'WALLET' && r.walletBalance != null && <div className="muted" style={{ textAlign: 'right', fontSize: 12, marginTop: 2 }}>Wallet balance: {money(r.walletBalance)}</div>}
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 11 }} className="muted">Thank you!</div>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="secondary" onClick={() => window.print()}>🖨 Print</button>
          <button onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
