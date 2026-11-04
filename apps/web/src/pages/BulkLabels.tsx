import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, MasterLabel } from '../api';
import { CourierSet, LABEL_CSS, labelPageCount } from './BdLabel';

/**
 * Bulk courier print — every AWB of an account code in one print job (Quick Book → My bookings).
 *   /labels/print?awbs=L1,L2,…           full set per AWB (labels + box details + POD copy + box stickers)
 *   /labels/print?awbs=L1,L2,…&only=pod  just the carrier's POD copy, one page per AWB
 */
export function BulkLabels() {
  const [params, setParams] = useSearchParams();
  const awbs = [...new Set(String(params.get('awbs') || '').split(',').map((a) => a.trim().toUpperCase()).filter(Boolean))];
  const only = params.get('only') === 'pod' ? 'pod' : undefined;
  const [sets, setSets] = useState<Record<string, MasterLabel>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [done, setDone] = useState(0);

  useEffect(() => {
    let alive = true;
    const queue = [...awbs];
    const worker = async () => {
      for (let a = queue.shift(); a; a = queue.shift()) {
        const awb = a;
        try { const r = await api.getLabels(awb); if (alive) setSets((s) => ({ ...s, [awb]: r.master })); }
        catch (e: any) { if (alive) setFailed((f) => ({ ...f, [awb]: e.message })); }
        if (alive) setDone((n) => n + 1);
      }
    };
    Promise.all([worker(), worker(), worker(), worker()]);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('awbs')]);

  const ready = awbs.filter((a) => sets[a]);
  const noCarrierAwb = ready.filter((a) => { const m = sets[a]; return m.vendor && m.vendor !== 'SELF' && !(m.carrierAwb || m.bdWaybill || m.forwardingAwb); });
  const pages = ready.reduce((n, a) => n + labelPageCount(sets[a], only), 0);
  const loading = done < awbs.length;
  const setMode = (pod: boolean) => { const p = new URLSearchParams(params); pod ? p.set('only', 'pod') : p.delete('only'); setParams(p, { replace: true }); };

  if (!awbs.length) return <p style={{ padding: 24 }}>No AWBs to print.</p>;
  return (
    <div className="cl-page">
      <div className="cl-toolbar no-print" style={{ width: 'min(100%, 420px)', flexWrap: 'wrap' }}>
        <b>{awbs.length} AWB{awbs.length > 1 ? 's' : ''}</b>
        <span className="cl-hint">{loading ? `Loading ${done}/${awbs.length}…` : `${pages} pages · 89 × 69 mm`}</span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button className={only ? 'secondary' : ''} style={{ fontWeight: only ? 400 : 700 }} onClick={() => setMode(false)}>Full set</button>
          <button className={only ? '' : 'secondary'} style={{ fontWeight: only ? 700 : 400 }} onClick={() => setMode(true)}>POD copies only</button>
        </span>
        <button onClick={() => window.print()} disabled={loading}>🖨 Print</button>
      </div>
      {noCarrierAwb.length > 0 && (
        <div className="no-print cl-warn" style={{ width: 'min(100%, 420px)' }}>
          ⚠ <b>{noCarrierAwb.length} not handed to the carrier yet</b> — their labels show our AWB, which the carrier can't scan: {noCarrierAwb.join(', ')}. Hand them off first, then reprint.
        </div>
      )}
      {Object.keys(failed).length > 0 && (
        <div className="no-print cl-warn" style={{ width: 'min(100%, 420px)', background: '#fdecea', borderColor: '#c0392b', color: '#7b1d12' }}>
          Couldn't load {Object.keys(failed).length}: {Object.entries(failed).map(([a, e]) => `${a} (${e})`).join(', ')}
        </div>
      )}
      {!loading && ready.map((a) => <CourierSet key={a} m={sets[a]} only={only} />)}
      <style>{LABEL_CSS}</style>
    </div>
  );
}
