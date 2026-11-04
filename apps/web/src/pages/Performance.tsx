import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

/**
 * Performance (#13-4) — one screen, two audiences:
 *  - internal "Carrier Performance": carrier / vendor-wise scorecard, priority carrier setting, patterns, NDR.
 *  - customer portal "Performance dashboard": the same numbers for the customer's own shipments, unified
 *    (no carrier names).
 * On-time = delivered within the carrier's standard transit for the lane (same rule as the SLA report).
 */
const ist = (d: number) => new Date(Date.now() - d * 864e5 + 330 * 60000).toISOString().slice(0, 10);
const fmt = (v: any, suf = '') => (v == null ? '—' : `${typeof v === 'number' ? v.toLocaleString('en-IN') : v}${suf}`);
const d10 = (v: any) => (v ? new Date(+new Date(v) + 330 * 60000).toISOString().slice(0, 10).split('-').reverse().join('-') : '—');
const tone = (p: number | null | undefined) => (p == null ? undefined : p >= 90 ? '#15803d' : p >= 75 ? '#b45309' : '#b42318');

async function xls(name: string, head: string[], rows: (string | number | null)[][]) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows.map((r) => r.map((v) => v ?? ''))]), 'Data');
  XLSX.writeFile(wb, name);
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="card" style={{ margin: 0, padding: '12px 14px' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div className="muted" style={{ fontSize: 11.5 }}>{sub}</div>}
    </div>
  );
}

const COLS = (internal: boolean) => [
  ['booked', 'Booked'], ['delivered', 'Delivered'], ['onTimePct', 'On time %'], ['avgTatDays', 'Avg days'], ['ndr', 'NDR'], ['ndrPct', 'NDR %'], ['rto', 'RTO'], ['rtoPct', 'RTO %'], ['open', 'In transit'],
  ...(internal ? [['sellPerKg', 'Sell ₹/kg'], ['costPerKg', 'Cost ₹/kg']] : []),
] as [string, string][];

function Table({ title, first, firstLabel, rows, internal, extra, file }: { title: string; first: string; firstLabel: string; rows: any[]; internal: boolean; extra?: [string, string]; file: string }) {
  const cols = COLS(internal);
  const head = [firstLabel, ...(extra ? [extra[1]] : []), ...cols.map((c) => c[1])];
  const body = rows.map((r) => [r[first], ...(extra ? [r[extra[0]]] : []), ...cols.map((c) => r[c[0]])]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <b>{title}</b>
        <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} disabled={!rows.length} onClick={() => xls(file, head, body)}>⬇ Excel</button>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: 12.5, minWidth: 760 }}>
          <thead><tr>{head.map((h, i) => <th key={h} style={{ textAlign: i < (extra ? 2 : 1) ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><strong>{r[first]}</strong></td>
                {extra && <td>{r[extra[0]]}</td>}
                {cols.map(([k]) => <td key={k} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: k === 'onTimePct' ? tone(r[k]) : undefined, fontWeight: k === 'onTimePct' ? 700 : undefined }}>{fmt(r[k], /Pct$/.test(k) ? '%' : '')}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={head.length} className="muted" style={{ textAlign: 'center', padding: 14 }}>No shipments in this period.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Priority() {
  const [p, setP] = useState<{ basis: string; weights: { price: number; tat: number; performance: number } } | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.carrierPriority().then(setP).catch(() => {}); }, []);
  if (!p) return null;
  const save = async () => { setMsg(''); try { setP(await api.setCarrierPriority(p)); setMsg('Saved — booking screens now rank carriers this way.'); } catch (e: any) { setMsg(e.message); } };
  const opts: [string, string][] = [['BALANCED', 'Balanced (weighted)'], ['PRICE', 'Lowest price'], ['TAT', 'Fastest transit'], ['PERFORMANCE', 'Best on-time %']];
  return (
    <div className="card">
      <b>Priority carrier setting</b>
      <div className="muted" style={{ fontSize: 12.5, margin: '2px 0 10px' }}>How New Shipment and Quick Booking rank carriers for a lane (the ★ pick). Performance = on-time % over the last 60 days.</div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {opts.map(([k, l]) => <button key={k} className={p.basis === k ? '' : 'secondary'} style={{ padding: '5px 12px' }} onClick={() => setP({ ...p, basis: k })}>{l}</button>)}
      </div>
      {p.basis === 'BALANCED' && (
        <div className="row" style={{ gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {(['price', 'tat', 'performance'] as const).map((k) => (
            <div key={k} style={{ width: 130 }}>
              <label>{k === 'tat' ? 'Transit weight' : k === 'price' ? 'Price weight' : 'On-time weight'}</label>
              <input type="number" min={0} max={100} value={p.weights[k]} onChange={(e) => setP({ ...p, weights: { ...p.weights, [k]: Number(e.target.value) } })} />
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 10, marginTop: 10, alignItems: 'center' }}>
        <button onClick={save}>Save setting</button>
        {msg && <span style={{ fontSize: 12.5 }}>{msg}</span>}
      </div>
    </div>
  );
}

export function Performance({ internal }: { internal: boolean }) {
  const [from, setFrom] = useState(ist(29));
  const [to, setTo] = useState(ist(0));
  const [vendor, setVendor] = useState('');
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [view, setView] = useState<'region' | 'city' | 'pincode'>('region');
  const load = () => {
    setBusy(true); setError('');
    (internal ? api.performance({ from, to, vendor: vendor || undefined }) : api.portalPerformance({ from, to }))
      .then(setD).catch((e) => setError(e.message)).finally(() => setBusy(false));
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const k = d?.kpis;
  const maxWeek = Math.max(1, ...(d?.trend ?? []).map((w: any) => w.booked));

  return (
    <div>
      <h1>{internal ? '🏁 Carrier Performance' : '📈 Performance dashboard'}</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        {internal ? 'Carrier / vendor-wise delivery performance, shipping patterns and open NDRs.' : 'How your shipments are performing — delivery, on-time, NDR and where you ship.'}
        {' '}On time = delivered within the standard transit days for the lane.
      </p>

      <div className="card">
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label>Booked from</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label>To</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          {internal && <div><label>Vendor code (optional)</label><input value={vendor} onChange={(e) => setVendor(e.target.value.toUpperCase())} placeholder="476954" style={{ width: 140 }} /></div>}
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Show'}</button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {k && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, margin: '10px 0' }}>
            <Kpi label="Booked" value={fmt(k.booked)} sub={`${d.from.split('-').reverse().join('-')} → ${d.to.split('-').reverse().join('-')}`} />
            <Kpi label="Delivered" value={fmt(k.delivered)} sub={k.deliveredPct != null ? `${k.deliveredPct}% of booked` : undefined} />
            <Kpi label="On time" value={fmt(k.onTimePct, '%')} color={tone(k.onTimePct)} sub={`${fmt(k.measured)} deliveries measured`} />
            <Kpi label="Avg transit" value={k.avgTatDays != null ? `${k.avgTatDays} d` : '—'} sub="booking → delivery" />
            <Kpi label="NDR (open)" value={fmt(k.ndr)} color={k.ndr ? '#b42318' : undefined} sub={k.ndrPct != null ? `${k.ndrPct}%` : undefined} />
            <Kpi label="RTO" value={fmt(k.rto)} sub={k.rtoPct != null ? `${k.rtoPct}%` : undefined} />
            <Kpi label="In transit" value={fmt(k.open)} />
          </div>

          {internal && <Table title="Carrier / vendor-wise" first="name" firstLabel="Carrier" rows={d.byVendor ?? []} internal file={`carrier-performance-${d.from}_${d.to}.xlsx`} />}
          {internal && <Priority />}

          <div className="card">
            <b>Weekly trend</b>
            <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
              {(d.trend ?? []).map((w: any) => (
                <div key={w.week} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 150px', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
                  <span className="muted">wk of {w.week.split('-').reverse().slice(0, 2).join('-')}</span>
                  <div style={{ background: 'var(--surface-2, #eef1f4)', borderRadius: 4, height: 14, position: 'relative' }}>
                    <div style={{ width: `${(w.booked / maxWeek) * 100}%`, height: '100%', background: 'var(--sky-soft, #cfe3f7)', borderRadius: 4 }} />
                    <div style={{ position: 'absolute', top: 0, left: 0, width: `${(w.delivered / maxWeek) * 100}%`, height: '100%', background: 'var(--brand, #0f766e)', borderRadius: 4, opacity: 0.85 }} />
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{w.delivered}/{w.booked} · <b style={{ color: tone(w.onTimePct) }}>{fmt(w.onTimePct, '%')}</b> on time</span>
                </div>
              ))}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>Dark = delivered, light = booked.</div>
          </div>

          <div className="row" style={{ gap: 6, margin: '12px 0 0' }}>
            <b style={{ marginRight: 6, alignSelf: 'center' }}>Shipping patterns</b>
            {(['region', 'city', 'pincode'] as const).map((v) => <button key={v} className={view === v ? '' : 'secondary'} style={{ padding: '4px 12px' }} onClick={() => setView(v)}>{v === 'region' ? 'Region' : v === 'city' ? 'Top cities' : 'Top pincodes'}</button>)}
          </div>
          {view === 'region' && <Table title="By destination region (zone)" first="region" firstLabel="Region" rows={d.byRegion ?? []} internal={internal} file={`patterns-region-${d.from}_${d.to}.xlsx`} />}
          {view === 'city' && <Table title="Top destination cities" first="city" firstLabel="City" rows={d.byCity ?? []} internal={internal} file={`patterns-city-${d.from}_${d.to}.xlsx`} />}
          {view === 'pincode' && <Table title="Top destination pincodes" first="pincode" firstLabel="Pincode" extra={['city', 'City']} rows={d.byPincode ?? []} internal={internal} file={`patterns-pincode-${d.from}_${d.to}.xlsx`} />}

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <b>Open NDR ({(d.ndr ?? []).length})</b>
              <button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} disabled={!(d.ndr ?? []).length}
                onClick={() => xls(`ndr-${d.from}_${d.to}.xlsx`, ['AWB', 'Booked', 'Consignee', 'City', 'Pincode', 'Reason', ...(internal ? ['Carrier'] : [])], d.ndr.map((n: any) => [n.awb, d10(n.bookedAt), n.consignee, n.city, n.pincode, n.reason, ...(internal ? [n.vendor] : [])]))}>⬇ Excel</button>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
              <table style={{ fontSize: 12.5, minWidth: 700 }}>
                <thead><tr><th>AWB</th><th>Booked</th><th>Consignee</th><th>City</th><th>Reason</th>{internal && <th>Carrier</th>}</tr></thead>
                <tbody>
                  {(d.ndr ?? []).map((n: any) => (
                    <tr key={n.awb}><td><Link to={`/tracker/${n.awb}`}><strong>{n.awb}</strong></Link></td><td>{d10(n.bookedAt)}</td><td>{n.consignee || '—'}</td><td>{n.city} {n.pincode}</td><td>{n.reason}</td>{internal && <td>{n.vendor}</td>}</tr>
                  ))}
                  {!(d.ndr ?? []).length && <tr><td colSpan={internal ? 6 : 5} className="muted" style={{ textAlign: 'center', padding: 14 }}>No open NDR 🎉</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
