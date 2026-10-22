import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { fmtDate } from '../format';

const MODE_LABEL: Record<string, string> = { EXPRESS: 'Express', AIR_FREIGHT: 'Air', OCEAN_FCL: 'Ocean FCL', OCEAN_LCL: 'Ocean LCL' };

export function IntlShipments() {
  const [rows, setRows] = useState<any[]>([]);
  const [mode, setMode] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  const load = () => { setErr(''); api.intlList({ mode: mode || undefined, status: status || undefined, q: q.trim() || undefined }).then(setRows).catch((e) => setErr(e.message)); };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [mode, status, q]);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>🌍 International shipments</h1>
        <Link to="/intl/book"><button>＋ New international job</button></Link>
      </div>
      {err && <div className="error">{err}</div>}
      <div className="card">
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search job / HAWB / MBL / consignee / container…" style={{ minWidth: 280 }} />
          <select value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All modes</option>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['BOOKED', 'PICKED_UP', 'IN_TRANSIT', 'CUSTOMS', 'ARRIVED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
          <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{rows.length} job(s)</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>Job No.</th><th>Mode</th><th>Dir</th><th>Customer</th><th>Lane</th><th>Consignee</th><th>Pcs</th><th>Gross / Chg kg</th><th>CBM</th><th>HAWB/MBL</th><th>Status</th><th>ETD→ETA</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}><Link to={`/intl/${r.jobNo}`}>{r.jobNo}</Link></td>
                  <td>{MODE_LABEL[r.mode] ?? r.mode}</td>
                  <td>{r.direction === 'IMPORT' ? 'IMP' : 'EXP'}</td>
                  <td>{r.customer?.legalName ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{(r.originCountry || '—')} → {(r.destCountry || '—')}</td>
                  <td>{r.consigneeName ?? '—'}</td>
                  <td>{r.packages}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.grossWeightKg ?? 0}{r.chargeableWeightKg ? ` / ${r.chargeableWeightKg}` : ''}</td>
                  <td>{r.volumeCbm ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{r.houseNo || r.masterNo || '—'}</td>
                  <td><span className={`badge ${r.status}`}>{r.status}</span></td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.etd ? fmtDate(r.etd) : '—'} → {r.eta ? fmtDate(r.eta) : '—'}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={12} className="muted">No international jobs{q || mode || status ? ' for this filter' : ' yet'}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
