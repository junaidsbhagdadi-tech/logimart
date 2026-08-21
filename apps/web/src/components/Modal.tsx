import { ReactNode } from 'react';

/** Reusable pop-in/out dialog for add/edit forms — no page scrolling. Billing-app style.
 *  Click the backdrop or ✕ to close; content scrolls inside if tall. */
export function Modal({ title, onClose, children, width = 640 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ width, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="secondary" onClick={onClose} style={{ padding: '4px 12px' }}>✕ Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
