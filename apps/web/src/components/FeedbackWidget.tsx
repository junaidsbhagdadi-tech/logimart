import { useState } from 'react';
import { api } from '../api';

/** Floating "Feedback" button + modal, shown on every page for testers. */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [rating, setRating] = useState(0);
  const [category, setCategory] = useState('change');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await api.submitFeedback({ message, rating: rating || undefined, category, page: window.location.pathname });
      setSent(true);
      setMessage('');
      setRating(0);
      setCategory('change');
      setTimeout(() => { setOpen(false); setSent(false); }, 1400);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="fab-feedback no-print" onClick={() => setOpen(true)}>💬 Feedback</button>

      {open && (
        <div className="modal-backdrop no-print" onClick={() => setOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h2>Share feedback</h2>
            {sent ? (
              <p style={{ color: 'var(--ok)', fontWeight: 700 }}>✓ Thanks! Your feedback was sent.</p>
            ) : (
              <>
                {error && <div className="error">{error}</div>}
                <label>Type of feedback</label>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="change">✏️ Change something</option>
                  <option value="add">➕ Add something new</option>
                  <option value="remove">➖ Remove / disable</option>
                  <option value="bug">🐞 Something's broken</option>
                  <option value="other">💬 Other</option>
                </select>
                <label style={{ marginTop: 10 }}>How is it working?</label>
                <div className="stars">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} onClick={() => setRating(n)} style={{ cursor: 'pointer', fontSize: 26, color: n <= rating ? '#f5a623' : '#d6deea' }}>★</span>
                  ))}
                </div>
                <label style={{ marginTop: 10 }}>What should we change, add, or remove?</label>
                <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)}
                  style={{ width: '100%', font: 'inherit', padding: 11, border: '1px solid var(--border)', borderRadius: 11 }} />
                <div className="row" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
                  <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
                  <button disabled={busy || message.trim().length < 3} onClick={submit}>{busy ? 'Sending…' : 'Send feedback'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
