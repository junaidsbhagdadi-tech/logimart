import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

const inr = (n: any) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const inr2 = (n: any) => '₹' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (n: any) => { const v = Number(n ?? 0); return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : inr(v); };
const dd = (s: any) => (s ? new Date(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—');

const STATUS_CLS: Record<string, string> = { PAID: 'DELIVERED', 'PART-PAID': 'PARTIAL', OVERDUE: 'CANCELLED', OPEN: 'CREATED' };

export function Customer360() {
  const { id } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => { if (id) api.customerOverview(id).then(setD).catch((e) => setError(e.message)); }, [id]);

  if (error) return <div className="error" style={{ margin: 20 }}>{error}</div>;
  if (!d) return <p className="muted" style={{ margin: 20 }}>Loading customer 360…</p>;

  const c = d.client, cr = d.credit, k = d.kpis, ag = d.aging;
  const buckets = [
    { key: 'current', label: '0–30', color: '#2f9e57' },
    { key: 'd1_30', label: '1–30 od', color: '#b7902a' },
    { key: 'd31_60', label: '31–60', color: '#c9772b' },
    { key: 'd61_90', label: '61–90', color: '#cf5a2a' },
    { key: 'd90_plus', label: '90+', color: '#c0392b' },
  ].filter((b) => ag[b.key] > 0);
  const agTotal = ag.total || 1;

  return (
    <>
      {/* identity + actions */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div className="row" style={{ alignItems: 'center', gap: 10 }}>
              <Link to="/customers" className="muted" style={{ textDecoration: 'none', fontSize: 13 }}>← Customers</Link>
              <h1 style={{ margin: 0 }}>{c.legalName}</h1>
              {c.isActive === false ? <span className="badge CANCELLED">INACTIVE</span> : <span className="badge DELIVERED">ACTIVE</span>}
              {c.isCreditHold && <span className="badge PARTIAL">CREDIT HOLD</span>}
              {cr.overdue > 0 && <span className="badge CANCELLED">OVERDUE {inr(cr.overdue)}</span>}
            </div>
            <div className="muted" style={{ marginTop: 5, fontSize: 13 }}>
              Code <b>{c.accountCode}</b>{c.gstin ? ` · GSTIN ${c.gstin}` : ''}{c.pan ? ` · PAN ${c.pan}` : ''}
              {(c.city || c.state) ? ` · ${[c.city, c.state].filter(Boolean).join(', ')}` : ''} · Net {c.creditDays}{c.salesPerson ? ` · Sales: ${c.salesPerson}` : ''}
            </div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={() => nav('/customers')}>✎ Edit</button>
            <Link to={`/invoices`}><button className="secondary">🧾 Invoices</button></Link>
            <Link to={`/create`}><button className="secondary">＋ New Shipment</button></Link>
            <Link to={`/invoices`}><button>🧾 Generate Invoice</button></Link>
          </div>
        </div>
      </div>

      {/* credit strip */}
      <div className="grid cols-4" style={{ gap: 12 }}>
        {[['Credit Limit', compact(cr.limit), 'var(--text)'], ['Outstanding', compact(cr.outstanding), 'var(--warn)'], ['Available', compact(cr.available), 'var(--ok)'], ['Overdue (>30d)', compact(cr.overdue), '#b26a00']].map(([l, v, col]) => (
          <div key={l as string} className="card"><label>{l}</label><div style={{ fontSize: 22, fontWeight: 800, color: col as string }}>{v}</div></div>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid cols-4" style={{ gap: 12 }}>
        <div className="card"><label>Shipments (FY)</label><div style={{ fontSize: 20, fontWeight: 800 }}>{k.shipmentsFY.toLocaleString('en-IN')}</div><div className="muted" style={{ fontSize: 11 }}>{k.shipmentsMonth} this month</div></div>
        <div className="card"><label>Billed (FY)</label><div style={{ fontSize: 20, fontWeight: 800 }}>{compact(k.billedFY)}</div><div className="muted" style={{ fontSize: 11 }}>{k.invoiceCount} invoices</div></div>
        <div className="card"><label>Collected (FY)</label><div style={{ fontSize: 20, fontWeight: 800 }}>{compact(k.collected)}</div><div className="muted" style={{ fontSize: 11 }}>{k.collectedPct}% of billed</div></div>
        <div className="card"><label>Wallet balance</label><div style={{ fontSize: 20, fontWeight: 800 }}>{compact(cr.walletBalance)}</div><div className="muted" style={{ fontSize: 11 }}>{c.accountType ?? 'CREDIT'} account</div></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.6fr 1fr', gap: 12, alignItems: 'start' }}>
        {/* LEFT: aging + invoices + ledger */}
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Receivables aging</h2><span className="muted">Total due {inr(ag.total)}</span></div>
            {ag.total > 0 ? (
              <div style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)', marginTop: 10 }}>
                {buckets.map((b) => (
                  <div key={b.key} title={`${b.label}: ${inr(ag[b.key])}`} style={{ width: `${(ag[b.key] / agTotal) * 100}%`, background: b.color, color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap' }}>
                    {ag[b.key] / agTotal > 0.12 ? `${b.label} · ${inr(ag[b.key])}` : ''}
                  </div>
                ))}
              </div>
            ) : <p className="muted" style={{ marginTop: 8 }}>Nothing outstanding. 🎉</p>}
          </div>

          <div className="card">
            <h2>Invoices ({d.invoices.length})</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Invoice</th><th>Period</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {d.invoices.map((i: any) => (
                    <tr key={i.id}>
                      <td><Link to={`/invoices/${i.id}`}><strong>{i.invoiceNo}</strong></Link></td>
                      <td>{dd(i.periodStart)}–{dd(i.periodEnd)}</td>
                      <td style={{ textAlign: 'right' }}>{inr(i.total)}</td>
                      <td style={{ textAlign: 'right' }}>{inr(i.remaining)}</td>
                      <td><span className={`badge ${STATUS_CLS[i.paidStatus] ?? 'CREATED'}`}>{i.paidStatus}{i.paidStatus === 'OVERDUE' ? ` ${i.daysOverdue}d` : ''}</span></td>
                    </tr>
                  ))}
                  {d.invoices.length === 0 && <tr><td colSpan={5} className="muted">No invoices yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Ledger (running balance)</h2>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Date</th><th>Entry</th><th style={{ textAlign: 'right' }}>Debit</th><th style={{ textAlign: 'right' }}>Credit</th><th style={{ textAlign: 'right' }}>Balance</th></tr></thead>
                <tbody>
                  {d.ledger.map((e: any) => {
                    const amt = Number(e.amount);
                    return (
                      <tr key={e.id}>
                        <td>{dd(e.createdAt)}</td>
                        <td>{e.entryType}</td>
                        <td style={{ textAlign: 'right' }}>{amt > 0 ? inr2(amt) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{amt < 0 ? inr2(-amt) : '—'}</td>
                        <td style={{ textAlign: 'right' }}>{inr2(e.balanceAfter)}</td>
                      </tr>
                    );
                  })}
                  {d.ledger.length === 0 && <tr><td colSpan={5} className="muted">No ledger entries.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: rate cards + shipments + activity */}
        <div className="grid" style={{ gap: 12 }}>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Rate cards ({d.rateCards.length})</h2><Link to="/customers" className="muted" style={{ fontSize: 12 }}>manage →</Link></div>
            {d.rateCards.length ? d.rateCards.map((rc: any) => (
              <div key={rc.id} style={{ marginTop: 8, fontSize: 12.5 }}>
                <span className="badge CREATED" style={{ marginRight: 6 }}>{rc.network}</span><strong>{rc.product}</strong> {rc.mode ? <span className="muted">· {rc.mode}</span> : null}
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {rc.slabs} slabs · Fuel {Number(rc.fuelPct)}%{Number(rc.fovPct) ? ` · FOV ${Number(rc.fovPct)}%` : ''}{Number(rc.odaFlat) || Number(rc.odaPerKg) ? ` · ODA ₹${Number(rc.odaFlat)}+₹${Number(rc.odaPerKg)}/kg` : ''}{Array.isArray(rc.cityRates) && rc.cityRates.length ? ` · 🏙 ${rc.cityRates.length} city rates` : ''}
                </div>
              </div>
            )) : <p className="muted" style={{ fontSize: 12 }}>No rate cards — add one from the customer row (👁 Cards).</p>}
          </div>

          <div className="card">
            <h2>Recent shipments</h2>
            <table>
              <tbody>
                {d.shipments.map((s: any) => (
                  <tr key={s.awb}>
                    <td><Link to={`/shipments/${s.awb}`}><strong>{s.awb}</strong></Link></td>
                    <td>{s.consigneeCity ?? s.destZone ?? '—'}</td>
                    <td style={{ textAlign: 'right' }}><span className="badge CREATED">{s.statusCode ?? s.status}</span></td>
                  </tr>
                ))}
                {d.shipments.length === 0 && <tr><td className="muted">No shipments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
