import { useEffect, useState } from 'react';
import { api } from '../api';

export function PerBoxRates() {
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [clientId, setClientId] = useState('');
  const [cards, setCards] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ product: '', network: 'SELF', fuelPct: '', fovPct: '', odaFlat: '', odaMin: '' });
  const [slabs, setSlabs] = useState([{ fromPcs: '1', toPcs: '15', perBox: '' }]);

  useEffect(() => { api.listClients().then(setClients).catch(() => {}); api.listMaster('PRODUCT').then(setProducts).catch(() => {}); }, []);
  const load = () => { if (clientId) api.listPerBoxCards(clientId).then(setCards).catch((e) => setErr(e.message)); else setCards([]); };
  useEffect(load, [clientId]);

  const setSlab = (i: number, k: string, v: string) => setSlabs((s) => s.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const addSlab = () => setSlabs((s) => [...s, { fromPcs: '', toPcs: '', perBox: '' }]);
  const rmSlab = (i: number) => setSlabs((s) => s.filter((_, j) => j !== i));

  const save = async () => {
    setErr(''); setMsg('');
    if (!clientId || !form.product) { setErr('Pick a customer and product.'); return; }
    const clean = slabs.filter((s) => s.perBox && s.fromPcs && s.toPcs).map((s) => ({ fromPcs: Number(s.fromPcs), toPcs: Number(s.toPcs), perBox: Number(s.perBox) }));
    if (!clean.length) { setErr('Add at least one slab with from/to pcs and a per-box rate.'); return; }
    try { await api.createPerBoxCard({ clientId, ...form, slabs: clean }); setMsg('✓ Per-box rate card saved — it now prices this customer’s product per box.'); setForm({ product: '', network: 'SELF', fuelPct: '', fovPct: '', odaFlat: '', odaMin: '' }); setSlabs([{ fromPcs: '1', toPcs: '15', perBox: '' }]); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const del = async (id: string) => { if (!confirm('Delete this per-box card? The customer’s product reverts to weight pricing.')) return; try { await api.deletePerBoxCard(id); load(); } catch (e: any) { setErr(e.message); } };

  return (
    <>
      <h1>📦 Per-Box Rates</h1>
      <p className="muted" style={{ marginTop: -6, maxWidth: '80ch' }}>Alternative freight basis — priced by the <strong>number of boxes</strong> (pcs slab, e.g. 1–15 @ ₹40/box) instead of weight. A customer × product uses <em>either</em> weight rate cards <em>or</em> per-box; when a per-box card exists it wins. Fuel, FOV, ODA and GST apply on top exactly like weight cards.</p>
      {err && <div className="error">{err}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--ok, #16a34a)', fontSize: 13 }}>{msg}</div>}

      <div className="card">
        <h2>New per-box card</h2>
        <div className="grid cols-4" style={{ gap: 10 }}>
          <div><label>Customer</label><select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">— select —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.accountCode} — {c.legalName}</option>)}</select></div>
          <div><label>Product</label><select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}><option value="">— select —</option>{products.map((p) => <option key={p.code} value={p.code}>{p.code} — {p.name}</option>)}</select></div>
          <div><label>Network / vendor</label><input value={form.network} onChange={(e) => setForm({ ...form, network: e.target.value })} placeholder="SELF / BDR" /></div>
          <div><label>Fuel %</label><input type="number" value={form.fuelPct} onChange={(e) => setForm({ ...form, fuelPct: e.target.value })} placeholder="0" /></div>
          <div><label>FOV %</label><input type="number" value={form.fovPct} onChange={(e) => setForm({ ...form, fovPct: e.target.value })} placeholder="0" /></div>
          <div><label>ODA flat ₹</label><input type="number" value={form.odaFlat} onChange={(e) => setForm({ ...form, odaFlat: e.target.value })} placeholder="0" /></div>
          <div><label>ODA min ₹</label><input type="number" value={form.odaMin} onChange={(e) => setForm({ ...form, odaMin: e.target.value })} placeholder="0" /></div>
        </div>
        <h3 style={{ marginBottom: 6 }}>Pcs slabs <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(amount = pcs × the per-box rate of the matching slab)</span></h3>
        <table style={{ fontSize: 13 }}>
          <thead><tr><th>From pcs</th><th>To pcs</th><th>Per box ₹</th><th></th></tr></thead>
          <tbody>
            {slabs.map((s, i) => (
              <tr key={i}>
                <td><input type="number" value={s.fromPcs} onChange={(e) => setSlab(i, 'fromPcs', e.target.value)} style={{ width: 90 }} /></td>
                <td><input type="number" value={s.toPcs} onChange={(e) => setSlab(i, 'toPcs', e.target.value)} style={{ width: 90 }} /></td>
                <td><input type="number" value={s.perBox} onChange={(e) => setSlab(i, 'perBox', e.target.value)} style={{ width: 110 }} /></td>
                <td>{slabs.length > 1 && <button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => rmSlab(i)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="secondary" onClick={addSlab}>＋ Add slab</button>
          <button onClick={save} disabled={!clientId || !form.product}>Save per-box card</button>
        </div>
      </div>

      {clientId && (
        <div className="card">
          <h2>Existing per-box cards</h2>
          {cards.length === 0 ? <p className="muted">None for this customer yet.</p> : cards.map((c) => (
            <div key={c.id} style={{ borderTop: '1px solid var(--border-2, #eee)', padding: '10px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{c.product} · {c.network}</strong>
                <div className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>Fuel {Number(c.fuelPct)}% · FOV {Number(c.fovPct)}% · ODA ₹{Number(c.odaFlat)} / min ₹{Number(c.odaMin)}</span>
                  <button className="secondary" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => del(c.id)}>🗑</button>
                </div>
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{c.slabs.map((s: any) => `${s.fromPcs}–${s.toPcs} pcs @ ₹${Number(s.perBox)}/box`).join('   ·   ')}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
