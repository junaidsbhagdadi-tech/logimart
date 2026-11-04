import { useEffect, useState } from 'react';
import { api } from '../api';

/** The Diwali notice from the request, as the editable starting point. */
const SAMPLE_SUBJECT = 'Service update — Diwali holidays';
const SAMPLE_BODY = `Dear Customers,

Greetings of the day!

On the occasion of Diwali, please note that our service partners across many parts of India will remain closed from 9th November to 11th November 2026. Consequently, cargo pickup and delivery services will not be available during this period.

If you have any urgent pickup requirements during these dates, kindly confirm the same by 5th November 2026 (EOD) so that we can make the necessary arrangements. However, please note that deliveries of such shipments may take place after 12th November 2026.

Additionally, due to Chhath Puja on 14th November 2026, cargo services in cities across the Eastern region will remain closed.

We request your cooperation and understanding in planning your shipments accordingly to avoid any inconvenience.

Thank you for your continued trust and support.
Wishing you and your family a very Happy, Prosperous & Joyful Diwali!

Do write or call back to your POCs for any confirmation required.

Thanks & Regards,
ExcelEx Group

Disclaimer: Do not reply to this email, it will not be attended to. Kindly contact your POCs.`;

/**
 * Bulk customer mail (Accounts + Customer Service) — one notice to every customer's MIS e-mail address,
 * all in BCC. Subject and message are fully editable; send yourself a test first.
 */
export function BulkMail() {
  const [subject, setSubject] = useState(SAMPLE_SUBJECT);
  const [body, setBody] = useState(SAMPLE_BODY);
  const [rec, setRec] = useState<{ customers: number; count: number; rows: { email: string; code: string; customer: string }[] } | null>(null);
  const [showList, setShowList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [tested, setTested] = useState(false);

  useEffect(() => { api.bulkMailRecipients().then(setRec).catch((e) => setError(e.message)); }, []);

  const send = async (test: boolean) => {
    setError(''); setMsg('');
    if (!subject.trim()) { setError('Enter a subject.'); return; }
    if (body.trim().length < 10) { setError('Write the message.'); return; }
    if (!test && !window.confirm(`Send "${subject.trim()}" to ${rec?.count ?? 'all'} customer e-mail addresses (BCC)?\n\nThis can't be recalled.`)) return;
    setBusy(true);
    try {
      const r = await api.bulkMailSend({ subject, body, test });
      if (test) { setTested(true); setMsg(`Test sent to ${r.to}. Check how it looks, then send to everyone.`); }
      else setMsg(r.message ?? `Sending to ${r.count} addresses.`);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 860 }}>
      <h1>✉️ Bulk customer mail</h1>
      <p className="muted" style={{ marginTop: -6 }}>One notice to every customer's MIS e-mail address — all in BCC, so no customer sees another. Sent from ExcelEx &lt;noreply@logimart.co.in&gt;.</p>

      <div className="card">
        <label>Subject</label>
        <input value={subject} onChange={(e) => { setSubject(e.target.value); setTested(false); }} placeholder="Service update — Diwali holidays" />
        <label style={{ marginTop: 12 }}>Message</label>
        <textarea value={body} onChange={(e) => { setBody(e.target.value); setTested(false); }} rows={20} style={{ width: '100%', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }} />
        <div className="muted" style={{ fontSize: 12 }}>A blank line starts a new paragraph.</div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <b>Recipients:</b> {rec ? <>{rec.count} e-mail addresses of {rec.customers} active customers <span className="muted">(contact + MIS e-mail)</span></> : 'loading…'}
            {rec && <button className="secondary" style={{ marginLeft: 8, padding: '2px 10px', fontSize: 12 }} onClick={() => setShowList((s) => !s)}>{showList ? 'Hide list' : 'Show list'}</button>}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="secondary" disabled={busy} onClick={() => send(true)}>Send test to me</button>
            <button disabled={busy || !rec?.count} onClick={() => send(false)} title={tested ? '' : 'Tip: send yourself a test first'}>{busy ? 'Sending…' : `Send to all ${rec?.count ?? ''} (BCC)`}</button>
          </div>
        </div>
        {msg && <div style={{ marginTop: 10, color: 'var(--ok, #16a34a)', fontWeight: 600 }}>{msg}</div>}
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
        {showList && rec && (
          <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 10 }}>
            <table style={{ fontSize: 12.5 }}>
              <thead><tr><th>E-mail</th><th>Code</th><th>Customer</th></tr></thead>
              <tbody>{rec.rows.map((r) => <tr key={r.email}><td>{r.email}</td><td>{r.code}</td><td>{r.customer}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
