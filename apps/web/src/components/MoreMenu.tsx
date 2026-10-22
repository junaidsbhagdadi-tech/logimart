import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, MoreHorizontal } from 'lucide-react';

/** One entry in the "More" menu: an action (onClick), an in-app link (to) or a new-tab link (href). */
export type MenuItem = { label: string; icon?: ReactNode; onClick?: () => void; to?: string; href?: string; danger?: boolean; title?: string; show?: boolean; node?: ReactNode };
export type MenuSection = { title: string; items: MenuItem[] };

/** "More ▾" dropdown that keeps secondary actions off the main action bar. Empty sections are hidden. */
export function MoreMenu({ sections, label = 'More' }: { sections: MenuSection[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const visible = sections.map((s) => ({ ...s, items: s.items.filter((i) => i.show !== false) })).filter((s) => s.items.length);
  if (!visible.length) return null;
  const close = () => setOpen(false);
  return (
    <div className="more" ref={ref}>
      <button className="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <MoreHorizontal aria-hidden /> {label} <ChevronDown aria-hidden />
      </button>
      {open && (
        <div className="menu" role="menu">
          {visible.map((sec, si) => (
            <div key={sec.title}>
              {si > 0 && <div className="menu-sep" />}
              <div className="menu-head">{sec.title}</div>
              {sec.items.map((it) => {
                const body = <>{it.icon}{it.label}</>;
                const cls = `menu-item${it.danger ? ' danger' : ''}`;
                if (it.node) return <div key={it.label} onClick={close}>{it.node}</div>;
                if (it.to) return <Link key={it.label} role="menuitem" className={cls} to={it.to} title={it.title} onClick={close}>{body}</Link>;
                if (it.href) return <a key={it.label} role="menuitem" className={cls} href={it.href} target="_blank" rel="noreferrer" title={it.title} onClick={close}>{body}</a>;
                return <button key={it.label} role="menuitem" className={cls} title={it.title} onClick={() => { close(); it.onClick?.(); }}>{body}</button>;
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
