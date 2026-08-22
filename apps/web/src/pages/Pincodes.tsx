import { useState } from 'react';
import { MasterData } from './MasterData';
import { ZoneUploads } from './ZoneUploads';
import { ZoneTat } from '../components/ZoneTat';

// One pincode home: serviceability + hubs + network coverage, the per-product zone map + EDL (ODA)
// matrix, and the zone×zone transit-TAT matrix. All keyed on pincode / its zones.
const TABS = [
  { key: 'service', label: '🗺 Serviceability & Hubs' },
  { key: 'zones', label: '🌐 Zone & EDL' },
  { key: 'tat', label: '⏱ TAT' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function Pincodes() {
  const [tab, setTab] = useState<TabKey>('service');
  return (
    <>
      <h1>📍 Pincodes and TAT</h1>
      <p className="muted" style={{ marginTop: -14 }}>
        Serviceable pincodes, hubs & network coverage, the per-product zone map and EDL (ODA) matrix, plus the zone→zone transit TAT. All keyed on pincode / its zones.
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
      {tab === 'service' ? <MasterData /> : tab === 'zones' ? <ZoneUploads /> : <ZoneTat />}
    </>
  );
}
