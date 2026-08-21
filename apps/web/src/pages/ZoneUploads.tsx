import { useEffect, useState } from 'react';
import { api } from '../api';

/** Upload screens for the two zone/EDL masters that previously loaded only via API:
 *  the pincode → per-product zone + EDL mapping, and the EDL (ODA) matrix per vendor. */
export function ZoneUploads() {
  const [vendors, setVendors] = useState<any[]>([]);
  useEffect(() => { api.listVendors().then((v) => setVendors(v.filter((x) => x.isActive !== false))).catch(() => {}); }, []);

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>Load the pincode → per-product zone mapping and the EDL (ODA) matrix. These drive booking zone resolution and ODA billing.</p>
      <PincodeMappingCard />
      <EdlMatrixCard vendors={vendors} />
    </>
  );
}

function PincodeMappingCard() {
  const [rows, setRows] = useState<Record<string, any>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<{ imported: number; failed: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const onFile = async (f?: File) => {
    if (!f) return; setErr(''); setRows(null); setResult(null); setFileName(f.name);
    try { const { parsePincodeMapping } = await import('../lib/rateSheet'); setRows(await parsePincodeMapping(f)); }
    catch (e: any) { setErr('Parse failed: ' + e.message); }
  };

  const upload = async () => {
    if (!rows?.length) return;
    setBusy(true); setErr(''); setResult(null);
    const B = 1000; let imported = 0, failed = 0;
    try {
      for (let i = 0; i < rows.length; i += B) {
        setProgress(`Uploading ${Math.min(i + B, rows.length)} / ${rows.length}…`);
        const r = await api.bulkPincodeMapping(rows.slice(i, i + B));
        imported += r.imported; failed += r.failed;
      }
      setResult({ imported, failed }); setProgress('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>📍 Pincode Mapping</h2>
      <p className="muted" style={{ fontSize: 12 }}>Columns: Pincode · Area · Service centre · State · DP/Surface/Apex/Ecom Zone · EDL · EDL Distance · TAT.</p>
      <input type="file" accept=".xlsx,.xlsb,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
      {rows && <div style={{ marginTop: 8, fontSize: 13 }}><b>{fileName}</b> — {rows.length.toLocaleString('en-IN')} pincodes parsed.
        {rows[0] && <span className="muted"> e.g. {rows[0].pincode} → DP:{rows[0].dpZone} Apex:{rows[0].apexZone} EDL:{rows[0].edl}</span>}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {progress && <div className="muted" style={{ marginTop: 8 }}>{progress}</div>}
      {result && <div className="card" style={{ borderLeft: '4px solid var(--ok)', marginTop: 8 }}>✓ Imported {result.imported.toLocaleString('en-IN')} pincodes{result.failed ? `, ${result.failed} failed` : ''}.</div>}
      <div className="row" style={{ marginTop: 12 }}><button onClick={upload} disabled={busy || !rows?.length}>{busy ? 'Uploading…' : `Upload ${rows?.length ? rows.length.toLocaleString('en-IN') + ' ' : ''}pincodes`}</button></div>
    </div>
  );
}

function EdlMatrixCard({ vendors }: { vendors: any[] }) {
  const [network, setNetwork] = useState('SELF');
  const [cells, setCells] = useState<any[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [existing, setExisting] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api.listEdl(network).then((r) => setExisting(r.length)).catch(() => setExisting(null)); }, [network, result]);

  const onFile = async (f?: File) => {
    if (!f) return; setErr(''); setCells(null); setResult(null); setFileName(f.name);
    try { const { parseEdlMatrix } = await import('../lib/rateSheet'); setCells(await parseEdlMatrix(f)); }
    catch (e: any) { setErr('Parse failed: ' + e.message); }
  };

  const upload = async () => {
    if (!cells?.length) return;
    setBusy(true); setErr(''); setResult(null);
    try { setResult(await api.bulkEdl(network, cells)); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>🛣 EDL (ODA) Matrix</h2>
      <p className="muted" style={{ fontSize: 12 }}>Km-band × weight-band charge table, one per vendor/network. Upload replaces the selected network's matrix.</p>
      <div className="grid cols-3" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div>
          <label>Network</label>
          <select value={network} onChange={(e) => setNetwork(e.target.value)}>
            <option value="SELF">SELF</option>
            {vendors.map((v) => <option key={v.id} value={(v.vendorCode || v.name).toUpperCase()}>{v.name}</option>)}
          </select>
          {existing != null && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{existing} cells currently loaded for {network}</div>}
        </div>
        <div style={{ gridColumn: 'span 2' }}>
          <label>EDL matrix file (.xlsx)</label>
          <input type="file" accept=".xlsx,.xlsb,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      </div>
      {cells && <div style={{ marginTop: 8, fontSize: 13 }}><b>{fileName}</b> — {cells.length} cells parsed.
        {cells[0] && <span className="muted"> e.g. {cells[0].kmFrom}-{cells[0].kmTo}km × {cells[0].wtFromKg}-{cells[0].wtToKg}kg = ₹{cells[0].rate}</span>}</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
      {result && <div className="card" style={{ borderLeft: '4px solid var(--ok)', marginTop: 8 }}>✓ Loaded {result.imported} EDL cells for {network}.</div>}
      <div className="row" style={{ marginTop: 12 }}><button onClick={upload} disabled={busy || !cells?.length}>{busy ? 'Uploading…' : `Upload EDL matrix → ${network}`}</button></div>
    </div>
  );
}
