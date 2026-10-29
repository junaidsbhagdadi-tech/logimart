import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

/**
 * Full-screen greeting shown once right after a sign-in (not on page refresh): Good morning /
 * afternoon / evening / Working late by IST login time, or "Welcome to Logimart" for a new account,
 * with today's counts. Closes itself after 5 s, on "Let's go", or on any click / key.
 */

type Slot = 'morning' | 'afternoon' | 'evening' | 'night' | 'welcome';
const THEMES: Record<Slot, { bg: string; fg: string; sub: string; acc: string; onAcc: string; emoji: string; hi: string; floats: string[] }> = {
  morning: { bg: '#FAEEDA', fg: '#633806', sub: '#854F0B', acc: '#BA7517', onAcc: '#fff', emoji: '🌅', hi: 'Good morning', floats: ['☁️', '🐦', '☁️'] },
  afternoon: { bg: '#E1F5EE', fg: '#04342C', sub: '#0F6E56', acc: '#1D9E75', onAcc: '#fff', emoji: '☀️', hi: 'Good afternoon', floats: ['☁️', '🚚', '☁️'] },
  evening: { bg: '#FAECE7', fg: '#4A1B0C', sub: '#993C1D', acc: '#D85A30', onAcc: '#fff', emoji: '🌇', hi: 'Good evening', floats: ['🏙️', '🚚', '☁️'] },
  night: { bg: '#26215C', fg: '#EEEDFE', sub: '#AFA9EC', acc: '#7F77DD', onAcc: '#26215C', emoji: '🌙', hi: 'Working late', floats: ['⭐', '✨', '⭐'] },
  welcome: { bg: '#E1F5EE', fg: '#04342C', sub: '#0F6E56', acc: '#1D9E75', onAcc: '#fff', emoji: '🎉', hi: 'Welcome to Logimart', floats: ['🎊', '📦', '🎊'] },
};
const istHour = () => new Date(Date.now() + 330 * 60000).getUTCHours();
const slotFor = (h: number): Slot => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 21 ? 'evening' : 'night');
const AUTO_CLOSE_MS = 5000;

const CSS = `
.lg-wrap{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;text-align:center;overflow:hidden;cursor:pointer;transition:opacity .35s}
.lg-wrap.out{opacity:0}
.lg-emo{font-size:96px;line-height:1;display:inline-block;animation:lg-rise 1.1s cubic-bezier(.2,.9,.3,1.3) both,lg-sway 3s ease-in-out 1.2s infinite}
.lg-up{opacity:0;animation:lg-up .7s ease-out forwards}
.lg-fl{position:absolute;left:0;font-size:26px;opacity:.55;animation:lg-drift linear infinite}
.lg-bar{height:4px;border-radius:2px;width:0;animation:lg-fill ${AUTO_CLOSE_MS}ms linear forwards}
@keyframes lg-rise{0%{transform:translateY(80px) scale(.4);opacity:0}100%{transform:none;opacity:1}}
@keyframes lg-sway{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(6deg)}}
@keyframes lg-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes lg-drift{from{transform:translateX(-80px)}to{transform:translateX(110vw)}}
@keyframes lg-fill{to{width:100%}}
@media (prefers-reduced-motion:reduce){.lg-wrap *{animation:none!important;opacity:1!important}.lg-bar{width:100%}}
`;

export function LoginGreeting() {
  const { user } = useAuth();
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem('lm_greet') === '1'; } catch { return false; } });
  const [leaving, setLeaving] = useState(false);
  const [g, setG] = useState<Awaited<ReturnType<typeof api.greeting>> | null>(null);

  useEffect(() => {
    if (!open) return;
    try { sessionStorage.removeItem('lm_greet'); } catch { /* ignore */ }
    api.greeting().then(setG).catch(() => {});
    const t = setTimeout(close, AUTO_CLOSE_MS);
    const onKey = () => close();
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() { setLeaving(true); setTimeout(() => setOpen(false), 350); }
  if (!open || !user) return null;

  const slot: Slot = g?.isNew ? 'welcome' : slotFor(istHour());
  const t = THEMES[slot];
  const first = String(g?.name || user.fullName || '').trim().split(/\s+/)[0] || '';
  const now = new Date();
  const when = `${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  const c = g?.counts;
  const chips: [string, string][] = !c ? [] : g!.isClient
    ? [['📦', `${c.bookedToday} booked today`], ['🚚', `${c.inTransit} in transit`], ['🛵', `${c.ofd} out for delivery`], ['✅', `${c.deliveredToday} delivered today`]]
    : [['📦', `${c.bookedToday} booked today`], ['🛵', `${c.ofd} out for delivery`], ['✅', `${c.deliveredToday} delivered today`], ...(c.exceptions ? [['⚠️', `${c.exceptions} exceptions`] as [string, string]] : [])];
  const line = slot === 'welcome'
    ? (g?.isClient ? "Your account is ready. Let's book your first shipment." : "You're all set. Let's get those boxes moving.")
    : slot === 'morning' ? "Fresh day, fresh pickups — let's get moving."
    : slot === 'afternoon' ? (c?.ofd ? `Halfway there — ${c.ofd} shipments are out for delivery.` : 'Halfway through the day — keep it rolling.')
    : slot === 'evening' ? 'Wrap-up time — close out the day strong.'
    : "Burning the midnight oil? Don't forget to rest.";

  return (
    <div className={`lg-wrap${leaving ? ' out' : ''}`} style={{ background: t.bg, color: t.fg }} onClick={close} role="dialog" aria-label={`${t.hi}, ${first}`}>
      <style>{CSS}</style>
      {t.floats.map((e, i) => <span key={i} className="lg-fl" aria-hidden="true" style={{ top: `${14 + i * 26}%`, animationDuration: `${12 + i * 4}s`, animationDelay: `${-i * 4}s` }}>{e}</span>)}
      <div style={{ position: 'relative', padding: '2rem 1.5rem', maxWidth: 640 }}>
        <div className="lg-emo" aria-hidden="true">{t.emoji}</div>
        <h1 className="lg-up" style={{ fontSize: 'clamp(28px, 5vw, 44px)', margin: '20px 0 6px', color: t.fg, animationDelay: '.35s' }}>{t.hi}{first ? `, ${first}` : ''} 👋</h1>
        <p className="lg-up" style={{ fontSize: 16, margin: '0 0 20px', color: t.sub, animationDelay: '.55s' }}>{when}</p>
        <div className="lg-up" style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 22, minHeight: 34, animationDelay: '.8s' }}>
          {chips.map(([e, s]) => <span key={s} style={{ fontSize: 14, padding: '6px 14px', borderRadius: 999, border: `1px solid ${t.acc}`, color: t.fg }}>{e} {s}</span>)}
        </div>
        <p className="lg-up" style={{ fontSize: 15, margin: '0 0 22px', fontStyle: 'italic', color: t.sub, animationDelay: '1s' }}>{line}</p>
        <button className="lg-up" style={{ animationDelay: '1.2s', padding: '11px 30px', fontSize: 16, borderRadius: 999, border: 'none', background: t.acc, color: t.onAcc }} onClick={(e) => { e.stopPropagation(); close(); }} autoFocus>Let's go →</button>
        <div style={{ margin: '24px auto 0', width: 200, height: 4, borderRadius: 2, overflow: 'hidden', background: `${t.sub}33` }}><div className="lg-bar" style={{ background: t.acc }} /></div>
        <p style={{ fontSize: 12, margin: '6px 0 0', color: t.sub }}>Opens in a few seconds · click anywhere to skip</p>
      </div>
    </div>
  );
}
