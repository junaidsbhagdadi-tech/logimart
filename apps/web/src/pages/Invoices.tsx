import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Credit, Invoice } from '../api';
import { useAuth } from '../auth';

export function Invoices() {
  const { user } = useAuth();
  const isFinance = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // default the client id: client admins use their own; finance defaults to demo client 1
  const defaultClientId = Number(user?.clientId ?? 1);
  const [clientId, setClientId] = useState(defaultClientId);
  const now = new Date();
  const [periodStart, setPeriodStart] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
  );
  const [periodEnd, setPeriodEnd] = useState(
    new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  );

  const load = () => {
    api.listInvoices().then(setInvoices).catch((e) => setError(e.message));
    api.getCredit(defaultClientId).then(setCredit).catch(() => {});
  };
  useEffect(load, []);

  const generate = async () => {
    setError('');
    setMsg('');
    try {
      const res = await api.generateInvoice(clientId, periodStart, periodEnd);
      setMsg(`Created ${res.invoice.invoiceNo} — total ₹${res.invoice.total}${res.creditHold ? ' (CREDIT HOLD!)' : ''}`);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <h1>Invoices</h1>
      {error && <div className="error">{error}</div>}
      {msg && <div className="card" style={{ borderLeft: '4px solid var(--brand)' }}>{msg}</div>}

      {credit && (
        <div className="card">
          <h2>Credit — {credit.legalName}</h2>
          <div className="grid cols-3">
            <div><label>Limit</label>₹{credit.creditLimit}</div>
            <div><label>Outstanding</label>₹{credit.outstandingBalance}</div>
            <div><label>Available</label>₹{credit.available.toFixed(2)}</div>
            <div><label>Terms</label>Net {credit.creditDays}</div>
            <div><label>Status</label>{credit.isCreditHold ? <span className="badge PARTIAL">CREDIT HOLD</span> : <span className="badge DELIVERED">OK</span>}</div>
          </div>
        </div>
      )}

      {isFinance && (
        <div className="card">
          <h2>Generate consolidated invoice</h2>
          <div className="grid cols-3">
            <div><label>Client ID</label><input type="number" value={clientId} onChange={(e) => setClientId(+e.target.value)} /></div>
            <div><label>Period start</label><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} /></div>
            <div><label>Period end</label><input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></div>
          </div>
          <button style={{ marginTop: 12 }} onClick={generate}>Generate invoice</button>
        </div>
      )}

      <div className="card">
        {invoices.length === 0 ? (
          <p className="muted">No invoices yet.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Invoice</th><th>Period</th><th>Lines</th><th>Total</th><th>Due</th><th>Status</th></tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><Link to={`/invoices/${inv.id}`}><strong>{inv.invoiceNo}</strong></Link></td>
                  <td>{inv.periodStart.slice(0, 10)} → {inv.periodEnd.slice(0, 10)}</td>
                  <td>{inv.lines.length}</td>
                  <td>₹{inv.total}</td>
                  <td>{inv.dueDate.slice(0, 10)}</td>
                  <td><span className={`badge ${inv.status}`}>{inv.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
