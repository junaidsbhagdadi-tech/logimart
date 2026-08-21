import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

type Row = {
  awb: string; bookDate: string; shipperName: string; customerCode: string; customerName: string;
  consigneeName: string; destination: string; product: string; vendor: string; forwardingAwb: string | null;
  actualWeight: number; chargeWeight: number; pieces: number; deliveryVendor: string; status: string;
};

const COLS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: 'awb', label: 'AWB No' },
  { key: 'bookDate', label: 'Book Date' },
  { key: 'shipperName', label: 'Shipper Name' },
  { key: 'customerCode', label: 'Customer Code' },
  { key: 'customerName', label: 'Customer Name' },
  { key: 'consigneeName', label: 'Consignee Name' },
  { key: 'destination', label: 'Destination' },
  { key: 'product', label: 'Product' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'forwardingAwb', label: 'Fwd AWB' },
  { key: 'actualWeight', label: 'Actual Weight', num: true },
  { key: 'chargeWeight', label: 'Charge Weight', num: true },
  { key: 'pieces', label: 'Pieces', num: true },
  { key: 'deliveryVendor', label: 'Delivery Vendor' },
];

const PAGE = 10;

export function AwbEntryList() {
  const [rows, setRows] = useState<Row[]>([]);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');

  const load = () => { api.awbList(300).then(setRows).catch((e) => setError(e.message)); };
  useEffect(load, []);

  const fmtDate = (d: string) => (d ? new Date(d).toLocaleDateString('en-GB') : '');

  const filtered = useMemo(() => {
    return rows.filter((r) =>
      COLS.every((c) => {
        const f = (filters[c.key] || '').trim().toLowerCase();
        if (!f) return true;
        const v = c.key === 'bookDate' ? fmtDate(r.bookDate) : String(r[c.key] ?? '');
        return v.toLowerCase().includes(f);
      }),
    );
  }, [rows, filters]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * PAGE, cur * PAGE + PAGE);

  const setFilter = (k: string, v: string) => { setFilters((f) => ({ ...f, [k]: v })); setPage(0); };

  return (
    <>
      <h1>📝 Shipment List</h1>
      {error && <div className="error">{error}</div>}

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" onClick={load} title="Refresh">⟳ Refresh</button>
            {Object.values(filters).some(Boolean) && <button className="secondary" onClick={() => setFilters({})}>Clear filters</button>}
          </div>
          <Link to="/create"><button>➕ New Shipment</button></Link>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>{COLS.map((c) => <th key={c.key}>{c.label}</th>)}<th>Action</th></tr>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} style={{ padding: 4 }}>
                    <input value={filters[c.key] || ''} onChange={(e) => setFilter(c.key, e.target.value)} placeholder={c.label}
                      style={{ fontSize: 12, padding: '5px 7px', fontWeight: 400 }} />
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {slice.map((r) => (
                <tr key={r.awb}>
                  <td><Link to={`/shipments/${r.awb}`}><strong>{r.awb}</strong></Link></td>
                  <td>{fmtDate(r.bookDate)}</td>
                  <td>{r.shipperName}</td>
                  <td>{r.customerCode}</td>
                  <td>{r.customerName}</td>
                  <td>{r.consigneeName || '—'}</td>
                  <td>{r.destination || '—'}</td>
                  <td>{r.product || '—'}</td>
                  <td>{r.vendor || '—'}</td>
                  <td>{r.forwardingAwb || '—'}</td>
                  <td>{r.actualWeight.toFixed(3)}</td>
                  <td>{r.chargeWeight.toFixed(3)}</td>
                  <td>{r.pieces}</td>
                  <td>{r.deliveryVendor}</td>
                  <td><Link to={`/shipments/${r.awb}`} className="muted" style={{ fontSize: 12 }}>open →</Link></td>
                </tr>
              ))}
              {slice.length === 0 && <tr><td colSpan={COLS.length + 1} className="muted">No entries match.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <div className="muted">Showing {filtered.length === 0 ? 0 : cur * PAGE + 1} to {Math.min(filtered.length, cur * PAGE + PAGE)} of {filtered.length} entries</div>
          <div className="row" style={{ gap: 6 }}>
            <button className="secondary" disabled={cur === 0} onClick={() => setPage(0)}>First</button>
            <button className="secondary" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Prev</button>
            <span className="badge CREATED" style={{ alignSelf: 'center' }}>{cur + 1} / {pages}</span>
            <button className="secondary" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button>
            <button className="secondary" disabled={cur >= pages - 1} onClick={() => setPage(pages - 1)}>Last</button>
          </div>
        </div>
      </div>
    </>
  );
}
