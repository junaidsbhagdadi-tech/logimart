import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type BulkJob } from '../api';
import { useAuth } from '../auth';
import { mapMode } from '../productMode';

/** Bulk booking — paste or upload a CSV (export from Excel) → many AWBs at once.
 * MPS: one row per BOX; rows sharing the same `ref` are grouped into a single AWB
 * (each row contributes one piece with its own dimensions). Shipment-level fields are
 * taken from the first row of each ref group. A blank ref = a single-box shipment. */
const COLS_STAFF = ['ref', 'awb', 'clientId', 'product', 'vendor', 'forwardingAwb', 'originPincode', 'destPincode', 'consigneeName', 'consigneePhone', 'consigneeAddress', 'declaredValue', 'pcs', 'deadKg', 'lengthCm', 'widthCm', 'heightCm', 'bookedAt', 'paymentTerm', 'freightToCollect', 'agreedFreight', 'referenceNo', 'goodsDesc'];
const COLS_CLIENT = COLS_STAFF.filter((c) => c !== 'clientId');

export function BulkBooking() {
  const { user } = useAuth();
  const ownClientId = user?.clientId ? Number(user.clientId) : null;
  const cols = ownClientId ? COLS_CLIENT : COLS_STAFF;

  const [hubIds, setHubIds] = useState<[number, number]>([1, 2]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadPct, setUploadPct] = useState<number | null>(null); // 0-100 while sending rows to the server
  const [job, setJob] = useState<(BulkJob & { failures?: { idx: number; awb?: string | null; error?: string | null }[] }) | null>(null);
  const [recent, setRecent] = useState<BulkJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [prodModes, setProdModes] = useState<Record<string, string>>({}); // product code -> transport mode

  const loadRecent = () => api.listBulkJobs().then((js) => {
    setRecent(js);
    // If a job is still running (e.g. we came back to the page), resume watching it.
    const active = js.find((j) => j.status === 'RUNNING' || j.status === 'PENDING');
    if (active && !job) watchJob(active.id);
  }).catch(() => {});

  useEffect(() => {
    api.listHubs().then((hs) => { if (hs[0]) setHubIds([Number(hs[0].id), Number((hs[1] ?? hs[0]).id)]); }).catch(() => {});
    api.listMaster('PRODUCT').then((r) => {
      const m: Record<string, string> = {};
      r.forEach((x) => { m[x.code.toUpperCase()] = mapMode((x.attrs as any)?.service || (x.attrs as any)?.mode || (x.attrs as any)?.serviceMode || (x.attrs as any)?.groupType); });
      setProdModes(m);
    }).catch(() => {});
    loadRecent();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll a job's progress every 2.5s until it finishes; safe to leave and come back to the page.
  const watchJob = (id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const tick = () => api.getBulkJob(id).then((j) => {
      if (!j) return;
      setJob(j);
      if (j.status === 'DONE' || j.status === 'CANCELLED') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        loadRecent();
      }
    }).catch(() => {});
    tick();
    pollRef.current = setInterval(tick, 2500);
  };

  // Guard: an Excel .xlsx pasted/loaded as text is a ZIP ("PK…" + [Content_Types].xml) or shows
  // replacement chars — parsing it yields garbage rows with empty customer codes. Flag it instead.
  const binaryPaste = useMemo(() => looksBinary(text), [text]);
  const rows = useMemo(() => (binaryPaste ? [] : parseCsv(text)), [text, binaryPaste]);
  // Group box-rows into shipments. The AWB is the shipment identity — rows sharing an awb are boxes
  // of one MPS shipment; distinct awbs are distinct shipments. Only fall back to `ref` when the awb
  // is blank (auto-generated), then to a per-row key. (Keying on `ref` alone was wrong: `ref` here is
  // a booking-BATCH id shared by thousands of unrelated AWBs, which merged them into giant shipments
  // with absurd summed weights.)
  const grouped = useMemo(() => {
    const m = new Map<string, Record<string, string>[]>();
    rows.forEach((r, i) => {
      const key = r.awb && r.awb.trim() ? `awb:${r.awb.trim()}`
        : (r.ref && r.ref.trim() ? `ref:${r.ref.trim()}` : `__row${i}`);
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    });
    return Array.from(m.values());
  }, [rows]);

  const downloadTemplate = () => {
    // A1 = a 2-box MPS shipment (two rows, same ref); A2 = a single-box shipment.
    const p = Object.keys(prodModes)[0] || 'SURFACE'; // a real product code if any, else a mode keyword
    // A1 = a manually-booked shipment (pre-assigned AWB BD10000001); A2 = blank awb -> auto-generated.
    // cols: … declaredValue, pcs, deadKg, lengthCm, widthCm, heightCm, bookedAt, paymentTerm, …
    // A1 = a 2-box MPS shipment (two rows, same ref). A2 = one row, pcs=3 → 3 identical boxes.
    const sample = ownClientId
      ? [
          `A1,BD10000001,${p},BDR,7712345678,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,1,5,30,20,15,2026-09-01 10:30,PREPAID,,,REF-A1,Apparel`,
          `A1,BD10000001,${p},BDR,7712345678,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,1,8,40,30,20,,,,,,`,
          `A2,,${p},DLY,,560001,400001,Beta Corp,9812345670,5 Fort Mumbai,12000,3,3,25,20,10,,TO_PAY,1500,,REF-A2,Electronics`,
        ].join('\n')
      : [
          `A1,BD10000001,1,${p},BDR,7712345678,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,1,5,30,20,15,2026-09-01 10:30,PREPAID,,,REF-A1,Apparel`,
          `A1,BD10000001,1,${p},BDR,7712345678,560001,110001,Acme Traders,9876543210,12 MG Road Bengaluru,45000,1,8,40,30,20,,,,,,`,
          `A2,,1,${p},DLY,,560001,400001,Beta Corp,9812345670,5 Fort Mumbai,12000,3,3,25,20,10,,TO_PAY,1500,,REF-A2,Electronics`,
        ].join('\n');
    const csv = cols.join(',') + '\n' + sample + '\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = 'logimart-bulk-booking-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  // Accept a real Excel file (.xlsx/.xls) directly — convert its first sheet to CSV with SheetJS —
  // or a plain .csv. Uploading an .xlsx used to dump its raw ZIP bytes into the box → "customer code
  // '' not found" on every row; now it just works.
  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(''); setJob(null);
    const name = f.name.toLowerCase();
    try {
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        setText(XLSX.utils.sheet_to_csv(ws));
        return;
      }
      const t = await f.text();
      if (looksBinary(t)) {
        // A .csv that is actually an .xlsx in disguise (or any binary) — read it as a workbook too.
        const XLSX = await import('xlsx');
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
        setText(XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]));
        return;
      }
      setText(t);
    } catch (e: any) {
      setError(`Could not read "${f.name}": ${e?.message || e}. Save it as CSV in Excel and try again.`);
    }
  };

  const submit = async () => {
    setError('');
    if (grouped.length === 0) { setError('No rows found. Paste CSV or upload a file.'); return; }
    const dtos = grouped.map((grp) => {
      const first = grp[0];
      const prodCode = (first.product || '').trim();
      // derive the transport mode from the product (master mapping first, then keyword)
      const serviceMode = prodModes[prodCode.toUpperCase()] || mapMode(prodCode) || 'ROAD_PTL';
      return {
        // Send the raw customer CODE (the API resolves code or internal id, case-insensitively).
        // Never Number() it — an alphabetic code like "O0020" would become NaN → null → "not found".
        clientId: ownClientId ?? (first.clientId || '').trim(),
        manualAwb: first.awb || undefined, // pre-assigned AWB for a manually-booked shipment
        product: prodCode || undefined,
        serviceMode,
        vendor: (first.vendor || '').trim() || undefined, // drives the vendor rate card
        forwardingAwb: (first.forwardingAwb || '').trim() || undefined, // carrier's forwarding AWB / tracking no.
        originHubId: hubIds[0], destHubId: hubIds[1],
        originZone: 'SOUTH', destZone: 'SOUTH',
        originPincode: first.originPincode || undefined,
        destPincode: first.destPincode || undefined,
        consigneeName: first.consigneeName || undefined,
        consigneePhone: first.consigneePhone || undefined,
        consigneeAddress: first.consigneeAddress || undefined,
        declaredValue: first.declaredValue ? Number(first.declaredValue) : undefined,
        goodsDesc: first.goodsDesc || undefined,
        referenceNo: first.referenceNo || undefined,
        paymentTerm: (first.paymentTerm || '').trim().toUpperCase() === 'TO_PAY' ? 'TO_PAY' : undefined,
        freightToCollect: first.freightToCollect ? Number(first.freightToCollect) : undefined,
        manualFreight: first.agreedFreight && !isNaN(Number(first.agreedFreight)) && Number(first.agreedFreight) > 0 ? Number(first.agreedFreight) : undefined,
        bookedAt: parseBookedAt(first.bookedAt), // manual booking date+time (DD-MM-YYYY Indian format)
        // `pcs` = number of pieces for the row; `deadKg` = the row's TOTAL dead weight, split evenly
        // across those pieces (so chargeable weight ≈ deadKg, not deadKg × pcs). Dims are per-piece
        // (usually a placeholder here; the team refines each box once the AWB is in hand).
        pieces: grp.flatMap((r) => {
          const n = Math.max(1, Math.floor(Number(r.pcs) || 1));
          const total = Number(r.deadKg) || 0.5 * n; // 0.5 kg/piece default when weight is blank
          const box = {
            deadKg: total / n,
            lengthCm: r.lengthCm ? Number(r.lengthCm) : undefined,
            widthCm: r.widthCm ? Number(r.widthCm) : undefined,
            heightCm: r.heightCm ? Number(r.heightCm) : undefined,
          };
          return Array.from({ length: n }, () => ({ ...box }));
        }),
      };
    });
    // Hand the whole batch to a BACKGROUND JOB: upload the rows in small chunks (fast inserts, no
    // pricing → no timeout), then start server-side processing. Booking then runs on the server row by
    // row (each ~1-1.5s through the rate engine) with no HTTP request held open, so you can close the
    // tab. This page polls progress. AWBs are unique, so re-running a file skips already-booked ones.
    // Upload rows in SMALL chunks so a batch's JSON body stays well under the proxy body limit — a
    // large chunk (esp. rows with many pieces) was exceeding it, getting a 413, and stopping midway.
    const UPLOAD_CHUNK = 100;
    setBusy(true); setUploadPct(0); setJob(null);
    let created: { id: string } | null = null;
    try {
      created = await api.createBulkJob();
      for (let i = 0; i < dtos.length; i += UPLOAD_CHUNK) {
        await api.appendBulkJobRows(created.id, dtos.slice(i, i + UPLOAD_CHUNK));
        setUploadPct(Math.round((Math.min(i + UPLOAD_CHUNK, dtos.length) / dtos.length) * 100));
      }
      await api.startBulkJob(created.id);
      setUploadPct(null);
      watchJob(created.id);
    }
    catch (e: any) {
      // If some rows uploaded before the error, still start the job so they book (don't lose them).
      if (created) { try { await api.startBulkJob(created.id); watchJob(created.id); } catch { /* ignore */ } }
      setError(`Upload interrupted: ${String(e?.message || e)}. Rows uploaded so far will still book — re-upload the file to add the rest (already-booked AWBs are skipped).`);
      setUploadPct(null);
    }
    finally { setBusy(false); }
  };

  return (
    <>
      <h1>📥 Bulk Booking</h1>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <h2>How it works</h2>
        <p className="muted" style={{ marginTop: -6 }}>
          Fill <strong>one box per row</strong> in Excel, save as CSV, then upload or paste below. Each <strong>distinct
          <code>awb</code> is one shipment</strong>; rows that share the same <code>awb</code> are boxes of one multi-box
          shipment (MPS), each carrying its own weight + dimensions (L×W×H cm). Fill <code>awb</code> to import a
          <strong> manually-booked</strong> shipment with its existing AWB; leave it blank to auto-generate (then rows
          sharing the same <code>ref</code> group into one AWB). The <code>product</code> column sets the service /
          transport mode (same as the booking form). E-way bills auto-generate when invoice value ≥ ₹50,000.
        </p>
        <p className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          <strong><code>pcs</code></strong> = number of pieces for that row and <strong><code>deadKg</code> = the row's TOTAL weight</strong> (split evenly across the pieces — so chargeable weight ≈ <code>deadKg</code>, not <code>deadKg</code>×<code>pcs</code>). Leave <code>pcs</code> blank/1 for a single box.
          <strong> <code>bookedAt</code></strong> = manual booking date (DD-MM-YYYY, e.g. <code>15-08-2026</code>, optional time <code>15-08-2026 10:30</code>); blank = now.
        </p>
        <p className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          <strong><code>vendor</code></strong> (e.g. BDR, DLY) picks the <strong>vendor rate card</strong> so pricing matches the assigned carrier — blank = SELF.
          <code> forwardingAwb</code> = the carrier's forwarding / tracking number handed off to that vendor (blank if not yet forwarded). Optional:
          <code> paymentTerm</code> (PREPAID / TO_PAY) + <code>freightToCollect</code> (₹ from consignee on To-Pay),
          <code> agreedFreight</code> (₹ one-off / "As Agreed" override — blank = rate card),
          <code> referenceNo</code> (your invoice / booking ref), <code> goodsDesc</code>.
        </p>
        <div className="row">
          <button className="secondary" onClick={downloadTemplate}>⬇ Download CSV template</button>
          <label className="secondary" style={{ padding: '10px 16px', borderRadius: 11, cursor: 'pointer', fontWeight: 600, fontSize: 13, border: '1px solid var(--border)' }}>
            📎 Upload CSV or Excel
            <input type="file" accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
        </div>
        <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>Columns: <code>{cols.join(', ')}</code></div>
      </div>

      <div className="card">
        <h2>Paste / review CSV</h2>
        {binaryPaste && (
          <div className="error" style={{ marginBottom: 10 }}>
            This looks like an <strong>Excel .xlsx file</strong>, not CSV text — that's why every row failed with an empty customer code.
            Use <strong>📎 Upload CSV or Excel</strong> above to load the .xlsx directly (it's now supported), or in Excel do <em>File → Save As → CSV</em> and paste that.
          </div>
        )}
        <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder={cols.join(',') + '\n…'}
          style={{ width: '100%', font: '13px monospace', padding: 12, border: '1px solid var(--border)', borderRadius: 11 }} />
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted">
            <strong>{rows.length.toLocaleString()}</strong> box(es) → <strong>{grouped.length.toLocaleString()}</strong> shipment(s)
            {uploadPct !== null && <> · uploading <strong>{uploadPct}%</strong>…</>}
          </div>
          <button disabled={busy || grouped.length === 0 || binaryPaste} onClick={submit}>{busy ? (uploadPct !== null ? `Uploading ${uploadPct}%…` : 'Starting…') : `Book ${grouped.length.toLocaleString()} shipment(s)`}</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Booking runs in the background on the server — once it starts you can <strong>close this tab</strong> and come back later; progress is saved. AWBs are unique, so re-uploading a file skips shipments already booked.</p>
      </div>

      {job && (
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>
            Booking {job.status === 'DONE' ? 'complete' : job.status === 'CANCELLED' ? 'cancelled' : 'in progress'}
            {' '}<span className={`badge ${job.status === 'DONE' ? 'DELIVERED' : job.status === 'CANCELLED' ? 'EXCEPTION' : 'AT_HUB'}`}>{job.status}</span>
          </h2>
          {/* progress bar */}
          <div style={{ height: 10, borderRadius: 6, background: 'var(--border)', overflow: 'hidden', margin: '6px 0 8px' }}>
            <div style={{ height: '100%', width: `${job.total ? Math.round((job.processed / job.total) * 100) : 0}%`, background: 'var(--accent, #0891b2)', transition: 'width .3s' }} />
          </div>
          <div className="muted" style={{ fontSize: 13 }}>
            <strong>{job.processed.toLocaleString()}</strong> of <strong>{job.total.toLocaleString()}</strong> processed
            {' · '}<span className="badge DELIVERED">{job.succeeded.toLocaleString()} booked</span>
            {job.failed > 0 && <> <span className="badge EXCEPTION">{job.failed.toLocaleString()} failed</span></>}
            {(job.status === 'RUNNING' || job.status === 'PENDING') && <> · <button className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => api.cancelBulkJob(job.id).then(() => watchJob(job.id))}>Stop</button></>}
          </div>
          {(job.status === 'RUNNING' || job.status === 'PENDING') && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Each shipment is priced through the rate engine (~1–1.5s), so a big file takes a while. You can close this tab — it keeps booking on the server.</p>
          )}
          {job.failures && job.failures.length > 0 && (
            <>
              <h3 style={{ margin: '12px 0 4px', fontSize: 14 }}>Failed rows {job.failed > job.failures.length ? `(first ${job.failures.length} of ${job.failed})` : `(${job.failed})`}</h3>
              <table>
                <thead><tr><th>Row</th><th>AWB</th><th>Error</th></tr></thead>
                <tbody>{job.failures.map((f) => (
                  <tr key={f.idx}><td>{f.idx + 1}</td><td className="mono">{f.awb || '—'}</td><td><span className="muted">{f.error}</span></td></tr>
                ))}</tbody>
              </table>
              {job.status === 'DONE' && <p className="muted" style={{ fontSize: 12 }}>Fix these in the sheet and re-upload — already-booked AWBs are skipped automatically.</p>}
            </>
          )}
        </div>
      )}

      {recent.length > 0 && (
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>Recent bulk jobs</h2>
          <table>
            <thead><tr><th>Started</th><th>Status</th><th>Progress</th><th>Booked</th><th>Failed</th><th></th></tr></thead>
            <tbody>
              {recent.map((j) => (
                <tr key={j.id}>
                  <td>{new Date(j.createdAt).toLocaleString('en-IN')}</td>
                  <td><span className={`badge ${j.status === 'DONE' ? 'DELIVERED' : j.status === 'CANCELLED' ? 'EXCEPTION' : 'AT_HUB'}`}>{j.status}</span></td>
                  <td>{j.processed.toLocaleString()}/{j.total.toLocaleString()}</td>
                  <td>{j.succeeded.toLocaleString()}</td>
                  <td>{j.failed > 0 ? <span className="badge EXCEPTION">{j.failed.toLocaleString()}</span> : '0'}</td>
                  <td><button className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => watchJob(j.id)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Parse a booking date. Indian sheets use DD-MM-YYYY (or DD/MM/YYYY) with an optional HH:MM time —
 *  JS's native `new Date("15-08-2026")` returns Invalid Date (and "01-08-2026" is misread as US
 *  MM-DD → wrong month), which silently failed/misdated bulk rows. Parse day-first explicitly and
 *  fall back to native parsing for ISO (YYYY-MM-DD) inputs. Returns an ISO string, or undefined. */
function parseBookedAt(s?: string): string | undefined {
  const v = (s || '').trim();
  if (!v) return undefined;
  const m = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0));
    return isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const d = new Date(v); // ISO (YYYY-MM-DD…) or other natively-parseable formats
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** True when the text is really a binary file (an Excel .xlsx is a ZIP starting "PK") rather than
 *  CSV — parsing it would yield garbage rows with empty codes, so we block + explain instead. */
function looksBinary(text: string): boolean {
  if (!text) return false;
  const head = text.slice(0, 2000);
  return head.startsWith('PK\x03\x04') || head.includes('[Content_Types].xml') || /�|\x00/.test(head);
}

/** Minimal CSV parser: header row + comma-separated values, honouring "quoted" fields. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim(); });
    return row;
  });
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
