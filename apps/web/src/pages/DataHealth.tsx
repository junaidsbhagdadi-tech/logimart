import { useEffect, useState } from 'react';
import { api } from '../api';

type Health = Awaited<ReturnType<typeof api.dataHealth>>;

const Badge = ({ ok, good, bad }: { ok: boolean; good: string; bad: string }) => (
  <span className={`badge ${ok ? 'DELIVERED' : 'EXCEPTION'}`} style={{ fontSize: 12 }}>{ok ? `✓ ${good}` : `✗ ${bad}`}</span>
);

export function DataHealth() {
  const [d, setD] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = () => { setBusy(true); setError(''); api.dataHealth().then(setD).catch((e) => setError(e.message)).finally(() => setBusy(false)); };
  useEffect(load, []);

  return (
    <>
      <h1>🩺 Data Health</h1>
      <p className="muted" style={{ marginTop: -8 }}>Master-data gaps that silently break booking or pricing. Fix these and the "no rate / no fuel" errors go away.</p>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="secondary" onClick={load} disabled={busy}>{busy ? 'Checking…' : '↻ Re-check'}</button>
      </div>

      {d && (
        <>
          {/* 1. Pincode zone gaps */}
          <div className="card">
            <h2 style={{ marginBottom: 4 }}>📍 Destination pincodes with no zone
              {' '}<span className={`badge ${d.pincodeZoneGaps.count ? 'EXCEPTION' : 'DELIVERED'}`}>{d.pincodeZoneGaps.count}</span></h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
              These pincodes appear as a shipment destination but have no surface/air zone in the directory, so the rate engine
              can't find a slab → <strong>"No rate"</strong>. Fix via <strong>Pincodes → Bulk mapping upload</strong> (set surface/apex zone).
            </p>
            {d.pincodeZoneGaps.count === 0 ? <p className="badge DELIVERED">All shipped-to pincodes are zoned ✓</p> : (
              <table>
                <thead><tr><th>Pincode</th><th>City</th><th>Issue</th></tr></thead>
                <tbody>{d.pincodeZoneGaps.sample.map((r) => (
                  <tr key={r.pincode}><td className="mono">{r.pincode}</td><td>{r.city ?? '—'}</td><td><span className="badge EXCEPTION">{r.issue}</span></td></tr>
                ))}</tbody>
              </table>
            )}
            {d.pincodeZoneGaps.count > d.pincodeZoneGaps.sample.length && (
              <p className="muted" style={{ fontSize: 12 }}>…and {d.pincodeZoneGaps.count - d.pincodeZoneGaps.sample.length} more.</p>
            )}
          </div>

          {/* 2. Fuel setup */}
          <div className="card">
            <h2 style={{ marginBottom: 8 }}>⛽ Fuel surcharge setup</h2>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
              <Badge ok={d.fuel.airDefaultSet} good="Air fuel default set" bad="Air fuel default NOT set" />
              <Badge ok={d.fuel.dieselMechanismSet} good="Diesel (surface) mechanism set" bad="No diesel mechanism" />
            </div>
            {!d.fuel.airDefaultSet && <p className="muted" style={{ fontSize: 12.5 }}>⚠ Air/APEX shipments will bill <strong>no FSC</strong>. Set it in <strong>Masters → ✈️ Air Fuel Surcharge — default %</strong>.</p>}
            {!d.fuel.dieselMechanismSet && <p className="muted" style={{ fontSize: 12.5 }}>⚠ Surface cards on FLAT 0% won't add a diesel surcharge. Configure the diesel mechanism in Masters, or set a flat surface fuel %.</p>}
            {d.fuel.zeroFuelActiveCards > 0 && (
              <>
                <p className="muted" style={{ fontSize: 12.5 }}>
                  <span className="badge AT_HUB">{d.fuel.zeroFuelActiveCards}</span> active rate card(s) across <strong>{d.fuel.zeroFuelCustomers}</strong> customer(s) are at <strong>0% fuel and not diesel-indexed</strong>.
                  {' '}Of these, <span className="badge EXCEPTION">{d.fuel.zeroFuelSurfaceCards}</span> are <strong>surface</strong> cards that truly bill <strong>no fuel line</strong> (fix these); the rest are air/express, covered by the air default above.
                </p>
                <table>
                  <thead><tr><th>Code</th><th>Customer</th><th>Surface (no fuel)</th><th>Air/express</th></tr></thead>
                  <tbody>{d.fuel.zeroFuelSample.map((c) => (
                    <tr key={c.code}>
                      <td className="mono">{c.code}</td>
                      <td>{c.name}</td>
                      <td>{c.surface > 0 ? <span className="badge EXCEPTION">{c.surface}</span> : <span className="muted">—</span>}</td>
                      <td>{c.air > 0 ? <span className="badge AT_HUB">{c.air}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
                {d.fuel.zeroFuelCustomers > d.fuel.zeroFuelSample.length && (
                  <p className="muted" style={{ fontSize: 12 }}>…and {d.fuel.zeroFuelCustomers - d.fuel.zeroFuelSample.length} more customer(s).</p>
                )}
              </>
            )}
          </div>

          {/* 3. Customers without a rate card */}
          <div className="card">
            <h2 style={{ marginBottom: 4 }}>💳 Active customers with no rate card
              {' '}<span className={`badge ${d.customersWithoutRateCard.count ? 'EXCEPTION' : 'DELIVERED'}`}>{d.customersWithoutRateCard.count}</span></h2>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>These customers can't be priced at all until a rate card is added (👁 Cards on the customer).</p>
            {d.customersWithoutRateCard.count === 0 ? <p className="badge DELIVERED">Every active customer has a rate card ✓</p> : (
              <table>
                <thead><tr><th>Code</th><th>Customer</th></tr></thead>
                <tbody>{d.customersWithoutRateCard.sample.map((c) => (
                  <tr key={c.code}><td className="mono">{c.code}</td><td>{c.name}</td></tr>
                ))}</tbody>
              </table>
            )}
            {d.customersWithoutRateCard.count > d.customersWithoutRateCard.sample.length && (
              <p className="muted" style={{ fontSize: 12 }}>…and {d.customersWithoutRateCard.count - d.customersWithoutRateCard.sample.length} more.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
