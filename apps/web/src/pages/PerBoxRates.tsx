import { useEffect, useState } from 'react';
import { api } from '../api';

export function PerBoxRates() {
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [clientId, setClientId] = useState('');
  const [cards, setCards] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ product: '', network: 'SELF', fuelPct: '', fovPct: '', odaFlat: '', odaMin: '' });
  const [slabs, setSlabs] = useState([{ fromKg: '0', toKg: '15', perBox: '' }, { fromKg: '15', toKg: '30', perBox: '' }]);

  useEffect(() => { api.listClients().then(setClients).catch(() => {}); api.listMaster('PRODUCT').then(setProducts).catch(() => {}); }, []);
  const load = () => { if (clientId) api.listPerBoxCards(clientId).then(setCards).catch((e) => setErr(e.message)); else setCards([]); };
  useEffect(load, [clientId]);

  const setSlab = (i: number, k: string, v: string) => setSlabs((s) => s.map((row, j) => (j === i ? { ...row, [k]: v } : row)));
  const addSlab = () => setSlabs((s) => [...s, { fromKg: '', toKg: '', perBox: '' }]);
  const rmSlab = (i: number) => setSlabs((s) => s.filter((_, j) => j !== i));

  const save = async () => {
    setErr(''); setMsg('');
    if (!clientId || !form.product) { setErr('Pick a customer and product.'); return; }
    const clean = slabs.filter((s) => s.perBox && s.fromKg !== '' && s.toKg !== '').map((s) => ({ fromKg: Number(s.fromKg), toKg: Number(s.toKg), perBox: Number(s.perBox) }));
    if (!clean.length) { setErr('Add at least one weight slab (from/to kg) with a per-box rate.'); return; }
    try { await api.createPerBoxCard({ clientId, ...form, slabs: clean }); setMsg('✓ Per-box rate card saved — each box is now priced by its weight slab.'); setForm({ product: '', network: 'SELF', fuelPct: '', fovPct: '', odaFlat: '', odaMin: '' }); setSlabs([{ fromKg: '0', toKg: '15', perBox: '' }, { fromKg: '15', toKg: '30', perBox: '' }]); load(); }
    catch (e: any) { setErr(e.message); }
  };
  const del = async (id: string) => { if (!confirm('Delete this per-box card? The customer’s product reverts to weight pricing.')) return; try { await api.deletePerBoxCard(id); load(); } catch (e: any) { setErr(e.message); } };

  return (
    <>
      <h1>📦 Per-Box Rates</h1>
      <p className="muted" style={{ marginTop: -6, maxWidth: '80ch' }}>Alternative freight basis — <strong>each box priced by its weight slab</strong> (e.g. 0–15 kg @ ₹40/box, 16–30 kg @ ₹70/box). At booking every box carries its own weight, so freight = the sum of each box's per‑box rate. A customer × product uses <em>either</em> weight rate cards <em>or</em> per‑box; when a per‑box card exists it wins. Fuel, FOV, ODA and GST apply on top exactly like weight cards.</p>
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
        <h3 style={{ marginBottom: 6 }}>Weight slabs <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>(each box is billed the per-box rate of the slab its weight falls in)</span></h3>
        <table style={{ fontSize: 13 }}>
          <thead><tr><th>From kg</th><th>To kg</th><th>Per box ₹</th><th></th></tr></thead>
          <tbody>
            {slabs.map((s, i) => (
              <tr key={i}>
                <td><input type="number" value={s.fromKg} onChange={(e) => setSlab(i, 'fromKg', e.target.value)} style={{ width: 90 }} /></td>
                <td><input type="number" value={s.toKg} onChange={(e) => setSlab(i, 'toKg', e.target.value)} style={{ width: 90 }} /></td>
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
              <div style={{ fontSize: 13, marginTop: 4 }}>{c.slabs.map((s: any) => `${Number(s.fromKg)}–${Number(s.toKg)} kg @ ₹${Number(s.perBox)}/box`).join('   ·   ')}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
