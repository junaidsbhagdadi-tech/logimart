import { useState } from 'react';
import { MasterData } from './MasterData';
import { ZoneUploads } from './ZoneUploads';

// One pincode home: serviceability + hubs + network coverage, and the per-product zone map + EDL
// (ODA) matrix. Both are keyed on pincode, so they live under one screen with two tabs instead of
// two sidebar entries.
const TABS = [
  { key: 'service', label: '🗺 Serviceability & Hubs' },
  { key: 'zones', label: '🌐 Zone & EDL' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function Pincodes() {
  const [tab, setTab] = useState<TabKey>('service');
  return (
    <>
      <h1>📍 Pincodes</h1>
      <p className="muted" style={{ marginTop: -14 }}>
        Serviceable pincodes, hubs & network coverage — plus the per-product zone map and EDL (ODA) matrix. All keyed on pincode.
      </p>
      <div className="card" style={{ padding: 14 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button key={t.key} className={t.key === tab ? '' : 'secondary'} style={{ padding: '8px 14px' }} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {tab === 'service' ? <MasterData /> : <ZoneUploads />}
    </>
  );
}
