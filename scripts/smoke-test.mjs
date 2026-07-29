// End-to-end smoke test against a live Akul ERP API.
// Usage: BASE=https://your-host node scripts/smoke-test.mjs
const BASE = process.env.BASE || 'http://localhost:3000';
const uuid = () => crypto.randomUUID();
const log = (...a) => console.log(...a);

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok && res.status !== 207) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return json;
}

const login = (email) =>
  api('/api/v1/auth/login', { method: 'POST', body: { email, password: 'akul1234' } })
    .then((r) => r.accessToken);

function scans(childIds, checkpoint, baseTime, opts = {}) {
  return childIds.map((barcode, i) => ({
    clientEventId: uuid(),
    barcode,
    checkpoint,
    scannedAt: new Date(baseTime + i * 1000).toISOString(),
    deviceSeq: opts.seqStart ? opts.seqStart + i : undefined,
    gps: opts.gps,
  }));
}

(async () => {
  log(`\n=== Akul ERP smoke test @ ${BASE} ===\n`);

  // 1) health
  const health = await api('/health');
  log('1. HEALTH:', health.status, '-', health.company);

  // 2) login as client admin, create a 5-box MPS shipment
  const clientToken = await login('client@demo.com');
  log('2. LOGIN client admin: ok');

  const shipment = await api('/api/v1/shipments', {
    method: 'POST',
    token: clientToken,
    body: {
      clientId: 1,
      serviceMode: 'ROAD_PTL',
      originHubId: 1,
      destHubId: 2,
      originZone: 'SOUTH',
      destZone: 'SOUTH',
      originPincode: '560001',
      destPincode: '600001',
      consigneeName: 'Acme Retail Pvt Ltd',
      consigneePhone: '9000000000',
      consigneeAddress: '45 Industrial Area, Phase 2',
      consigneeCity: 'Chennai',
      declaredValue: 60000,
      goodsDesc: 'Auto components',
      pieces: [
        { deadKg: 5, lengthCm: 40, widthCm: 30, heightCm: 20 }, // vol 4.8
        { deadKg: 8, lengthCm: 50, widthCm: 40, heightCm: 30 }, // vol 12
        { deadKg: 3, lengthCm: 30, widthCm: 20, heightCm: 10 }, // vol 1.2
        { deadKg: 12, lengthCm: 60, widthCm: 50, heightCm: 40 }, // vol 24
        { deadKg: 2, lengthCm: 25, widthCm: 20, heightCm: 15 }, // vol 1.5
      ],
    },
  });
  const awb = shipment.awb;
  const childIds = shipment.pieces.map((p) => p.childId);
  log(`3. CREATED MPS shipment ${awb}  (${shipment.pieceCount} boxes)`);
  shipment.pieces.forEach((p) =>
    log(`     ${p.childId}  Box ${p.sequenceNo}/${shipment.pieceCount}  dead=${p.deadKg}kg vol=${p.volKg}kg`),
  );
  log(`   totals: dead=${shipment.totalDeadKg}kg vol=${shipment.totalVolKg}kg`);

  // 3) labels
  const labels = await api(`/api/v1/shipments/${awb}/print-mps-labels`, { token: clientToken });
  const m = labels.master;
  log(`4. LABELS: 1 full shipping label + ${labels.labels.length} MPS child labels`);
  log(`     SHIP LABEL ${m.lrNumber}: FROM ${m.consignor.name} → TO ${m.consignee.name} (${m.consignee.address})`);
  log(`     route ${m.route}, ${m.pieceCount} pcs, dead ${m.totalDeadKg}kg / vol ${m.totalVolKg}kg`);

  // 4) ops user scans
  const opsToken = await login('hub@akullogistics.com');
  log('5. LOGIN hub manager: ok');

  const t0 = Date.now();
  // pickup all 5, then hub_in all 5, then load all 5
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken,
    body: { deviceId: 'TEST-DEV-1', events: scans(childIds, 'PICKUP', t0, { seqStart: 1 }) } });
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken,
    body: { deviceId: 'TEST-DEV-1', events: scans(childIds, 'HUB_IN', t0 + 60000, { seqStart: 10 }) } });

  // idempotency check: resend one LOAD batch twice
  const loadBatch = { deviceId: 'TEST-DEV-1', events: scans(childIds, 'LOAD', t0 + 120000, { seqStart: 20 }) };
  const r1 = await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken, body: loadBatch });
  const r2 = await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken, body: loadBatch });
  log(`6. BULK-SCAN load x5: accepted=${r1.accepted.length}, replay accepted=${r2.accepted.length}, replay duplicate=${r2.duplicate.length}`);

  let s = await api(`/api/v1/shipments/${awb}`, { token: clientToken });
  log(`   -> master status after all loaded: ${s.status}  (expect IN_TRANSIT)`);

  // 5) deliver only 4 of 5 -> PARTIAL
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken,
    body: { deviceId: 'TEST-DEV-1', events: scans(childIds.slice(0, 4), 'DELIVERY', t0 + 600000, { seqStart: 30, gps: { lat: 17.385, lng: 78.486 } }) } });
  s = await api(`/api/v1/shipments/${awb}`, { token: clientToken });
  log(`7. PARTIAL DELIVERY 4/5 -> status: ${s.status}, delivered=${s.rollup.delivered}/${s.rollup.pieceCount}, isShort=${s.rollup.isShort}  (expect PARTIAL)`);

  // 6) deliver the 5th -> DELIVERED
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken,
    body: { deviceId: 'TEST-DEV-1', events: scans(childIds.slice(4), 'DELIVERY', t0 + 700000, { seqStart: 40 }) } });
  s = await api(`/api/v1/shipments/${awb}`, { token: clientToken });
  log(`8. FINAL box delivered -> status: ${s.status}, delivered=${s.rollup.delivered}/${s.rollup.pieceCount}  (expect DELIVERED)`);

  // ---- Ground ops: POD ----
  const pod = await api(`/api/v1/shipments/${awb}/pod`, {
    method: 'POST', token: opsToken,
    body: { gpsLat: 17.385, gpsLng: 78.486, piecesDelivered: 5 },
  });
  log(`9. POD recorded: short=${pod.isShort}, pieces=${pod.pod.piecesDelivered}/${pod.expected}`);

  // ---- Finance ----
  const quote = await api(`/api/v1/shipments/${awb}/rate-quote`, { token: clientToken });
  log(`10. RATE QUOTE: ${quote.chargeableKg}kg chargeable -> freight ₹${quote.freight}, subtotal ₹${quote.subtotal} +GST ₹${quote.gst} = ₹${quote.grandTotal}`);

  const financeToken = await login('finance@akullogistics.com');
  const today = new Date();
  const periodStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const gen = await api('/api/v1/billing/invoices/generate', {
    method: 'POST', token: financeToken,
    body: { clientId: 1, periodStart, periodEnd },
  });
  log(`11. INVOICE ${gen.invoice.invoiceNo}: ${gen.invoice.lines.length} lines, taxable ₹${gen.invoice.subtotal}, CGST ₹${gen.invoice.cgst}+SGST ₹${gen.invoice.sgst} (IGST ₹${gen.invoice.igst}), total ₹${gen.invoice.total}, SAC ${gen.invoice.sacCode}, POS ${gen.invoice.placeOfSupply}`);
  log(`    credit: balance ₹${gen.newBalance} / limit ₹${gen.creditLimit} -> hold=${gen.creditHold}`);

  const credit = await api('/api/v1/clients/1/credit', { token: financeToken });
  log(`12. CREDIT: outstanding ₹${credit.outstandingBalance}, available ₹${credit.available}, Net ${credit.creditDays}`);

  const disp = await api(`/api/v1/billing/invoices/${gen.invoice.id}/dispute`, {
    method: 'POST', token: financeToken,
    body: { shipmentId: Number(s.id ?? shipment.id), reason: 'weight variance dispute (test)' },
  });
  log(`13. DISPUTE: locked=${disp.lockedLines}, clean-open lines=${disp.cleanOpenLines} (clean stays payable ₹${disp.cleanOpenAmount.toFixed(2)})`);

  const tds = 100;
  const pay = await api(`/api/v1/billing/invoices/${gen.invoice.id}/pay`, {
    method: 'POST', token: financeToken,
    body: { amount: +(Number(gen.invoice.total) - tds).toFixed(2), tds },
  });
  log(`14. PAYMENT received ₹${pay.received} + TDS ₹${pay.tds} = settled ₹${pay.settled} -> balance ₹${pay.newBalance}, paid=${pay.fullyPaid}`);

  // ---- Compliance ----
  const cn = await api(`/api/v1/shipments/${awb}/consignment-note`, { token: clientToken });
  log(`15. CONSIGNMENT NOTE: LR ${cn.lrNumber}, carrier "${cn.carrier.name}", ${cn.pieces.length} pieces`);

  const ewb = await api(`/api/v1/shipments/${awb}/eway-bill`, {
    method: 'POST', token: clientToken,
    body: { declaredValue: 75000, vehicleNo: 'KA01AB1234', distanceKm: 600 },
  });
  log(`16. E-WAY BILL: ${ewb.ewbNo} (${ewb.mode}), valid to ${ewb.validUpto.slice(0, 10)}`);

  const einv = await api(`/api/v1/billing/invoices/${gen.invoice.id}/einvoice`, {
    method: 'POST', token: financeToken,
  });
  log(`17. E-INVOICE: IRN ${einv.irn.slice(0, 24)}… (${einv.mode})`);

  // ---- Public tracking (no auth) ----
  const trk = await api(`/api/v1/track/${awb}`);
  log(`18. PUBLIC TRACK: ${trk.status}, to ${trk.destination}, ${trk.timeline.length} timeline events`);

  // ---- Notifications ----
  const notifs = await api('/api/v1/notifications', { token: financeToken });
  log(`19. NOTIFICATIONS recorded: ${notifs.length} (latest: ${notifs[0]?.kind} — ${notifs[0]?.message?.slice(0, 50)}…)`);

  // ---- Master data: onboard customer + rate matrix + surcharge-aware quote ----
  const adminToken = await login('admin@akullogistics.com');
  const stamp = Date.now().toString().slice(-6);
  const newClient = await api('/api/v1/clients', {
    method: 'POST', token: adminToken,
    body: { legalName: `Smoke Traders ${stamp}`, gstin: '29ABCDE1234F1Z5', city: 'Bengaluru', pincode: '560096', contactPhone: '9999900000', creditLimit: 200000, creditDays: 45 },
  });
  log(`20. CUSTOMER onboarded: ${newClient.legalName} (${newClient.accountCode}), Net ${newClient.creditDays}`);

  await api('/api/v1/rate-cards', {
    method: 'POST', token: adminToken,
    body: { clientId: Number(newClient.id), originZone: 'SOUTH', destZone: 'SOUTH', serviceMode: 'ROAD_PTL',
      perKgRate: 15, minCharge: 200, fuelPct: 8, fovPct: 0.1, fovMin: 100, odaFlat: 500, docketCharge: 50 },
  });
  log(`21. RATE CARD added (₹15/kg, fuel 8%, FOV 0.1%/₹100 min, ODA ₹500, docket ₹50)`);

  const ship2 = await api('/api/v1/shipments', {
    method: 'POST', token: adminToken,
    body: { clientId: Number(newClient.id), serviceMode: 'ROAD_PTL', originHubId: 1, destHubId: 2,
      originZone: 'SOUTH', destZone: 'SOUTH', declaredValue: 80000, isOda: true, goodsDesc: 'Electronics',
      pieces: [{ deadKg: 10, lengthCm: 50, widthCm: 40, heightCm: 30 }] },
  });
  const q2 = await api(`/api/v1/shipments/${ship2.awb}/rate-quote`, { token: adminToken });
  log(`22. SURCHARGE QUOTE ${ship2.awb}: freight ₹${q2.freight}, fuel ₹${q2.fuel}, FOV ₹${q2.fov}, ODA ₹${q2.oda}, docket ₹${q2.docket} -> subtotal ₹${q2.subtotal} +GST ₹${q2.gst} = ₹${q2.grandTotal}`);
  log(`    (FOV>0: ${q2.fov > 0}, ODA>0: ${q2.oda > 0})`);

  // ---- KPI dashboard ----
  const stats = await api('/api/v1/stats/overview', { token: adminToken });
  log(`23. STATS: ${stats.shipments.total} shipments, ${stats.deliveredPct}% delivered, ${stats.openExceptions} exceptions, revenue ₹${stats.revenueThisMonth}, receivables ₹${stats.outstandingReceivables}`);

  // ---- Pickup request lifecycle ----
  const pk = await api('/api/v1/pickups', {
    method: 'POST', token: clientToken,
    body: { pickupAddress: '12 MG Road', city: 'Bengaluru', pincode: '560001', estPieces: 3 },
  });
  await api(`/api/v1/pickups/${pk.id}/assign`, { method: 'POST', token: adminToken, body: { riderId: 1 } });
  const pkDone = await api(`/api/v1/pickups/${pk.id}/complete`, { method: 'POST', token: adminToken });
  log(`24. PICKUP #${pk.id}: REQUESTED -> ASSIGNED -> ${pkDone.status}`);

  // ---- Manifest / trip workflow ----
  const man = await api('/api/v1/manifests', {
    method: 'POST', token: adminToken,
    body: { vehicleNo: 'KA01AB1234', fromHubId: 1, toHubId: 2 },
  });
  await api(`/api/v1/manifests/${man.id}/attach`, { method: 'POST', token: adminToken, body: { awbs: [awb] } });
  const sealed = await api(`/api/v1/manifests/${man.id}/seal`, { method: 'POST', token: adminToken });
  log(`25. MANIFEST ${man.code}: attached ${awb}, sealed -> status=${sealed.status}, ${sealed.shipments.length} consignment(s)`);

  // ---- User management ----
  const newUser = await api('/api/v1/users', {
    method: 'POST', token: adminToken,
    body: { fullName: `Test Handler ${stamp}`, email: `handler${stamp}@akullogistics.com`, password: 'pass1234', role: 'WAREHOUSE_HANDLER' },
  });
  const users = await api('/api/v1/users', { token: adminToken });
  log(`26. USER created: ${newUser.email} (${newUser.role}); total users now ${users.length}`);

  // ---- Pincode directory + region classification ----
  const gau = await api('/api/v1/pincodes/781001'); // public
  const unknown = await api('/api/v1/pincodes/411045'); // not in directory, derived
  log(`27. PINCODE 781001 -> ${gau.city}, ${gau.state} · region ${gau.region} (tier ${gau.tier}, ODA ${gau.isOda})`);
  log(`28. PINCODE 411045 (not in directory) -> region ${unknown.region}, known=${unknown.known} (derived from PIN zone)`);

  // ---- POD image upload ----
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'pod.png');
  const upRes = await fetch(`${BASE}/api/v1/uploads?kind=pod_stamp`, {
    method: 'POST', headers: { authorization: `Bearer ${opsToken}` }, body: fd,
  });
  const up = await upRes.json();
  const served = await fetch(`${BASE}${up.url}`);
  log(`29. POD UPLOAD: ${up.url} (served HTTP ${served.status}, ${served.headers.get('content-type')})`);

  await api(`/api/v1/shipments/${awb}/pod?force=true`, {
    method: 'POST', token: opsToken,
    body: { gpsLat: 17.4, gpsLng: 78.5, piecesDelivered: 5, stampPhotoUrl: up.url },
  });
  const sp = await api(`/api/v1/shipments/${awb}`, { token: clientToken });
  log(`30. POD with photo on ${awb}: pods=${sp.pods?.length}, photo=${sp.pods?.[0]?.stampPhotoUrl}`);

  // ---- Tester feedback ----
  await api('/api/v1/feedback', { method: 'POST', token: clientToken, body: { message: 'Smoke test feedback — booking flow is smooth', rating: 5, page: '/create' } });
  const fb = await api('/api/v1/feedback', { token: adminToken });
  log(`31. FEEDBACK submitted; admin inbox has ${fb.length} item(s), latest: "${fb[0]?.message?.slice(0, 40)}…" (${fb[0]?.rating}★ from ${fb[0]?.userName})`);

  // ---- Rider mobile workflow: assign delivery -> tasks -> OFD -> deliver + POD ----
  const usersList = await api('/api/v1/users', { token: adminToken });
  const driverId = Number(usersList.find((u) => u.role === 'DRIVER').id);
  const rship = await api('/api/v1/shipments', {
    method: 'POST', token: adminToken,
    body: { clientId: 1, serviceMode: 'ROAD_PTL', originHubId: 1, destHubId: 2, originZone: 'SOUTH', destZone: 'SOUTH',
      originPincode: '560001', destPincode: '600001', consigneeName: 'Beta Stores', consigneeAddress: '9 Mount Road',
      consigneeCity: 'Chennai', consigneePhone: '9876500000', pieces: [{ deadKg: 6, lengthCm: 40, widthCm: 30, heightCm: 20 }] },
  });
  const rAwb = rship.awb, rChild = rship.pieces.map((p) => p.childId), tt = Date.now();
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken, body: { deviceId: 'D', events: scans(rChild, 'PICKUP', tt, { seqStart: 1 }) } });
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken, body: { deviceId: 'D', events: scans(rChild, 'HUB_IN', tt + 1000, { seqStart: 5 }) } });
  await api('/api/v1/scans/bulk-sync', { method: 'POST', token: opsToken, body: { deviceId: 'D', events: scans(rChild, 'LOAD', tt + 2000, { seqStart: 9 }) } });
  await api(`/api/v1/shipments/${rAwb}/assign-delivery`, { method: 'POST', token: opsToken, body: { riderId: driverId } });

  const driverToken = await login('driver@akullogistics.com');
  const tasks = await api('/api/v1/rider/tasks', { token: driverToken });
  log(`32. RIDER TASKS: ${tasks.pickups.length} pickups, ${tasks.deliveries.length} deliveries; has ${rAwb}: ${tasks.deliveries.some((d) => d.awb === rAwb)}`);

  await api(`/api/v1/shipments/${rAwb}/ofd`, { method: 'POST', token: driverToken });
  const ofdS = await api(`/api/v1/shipments/${rAwb}`, { token: adminToken });
  log(`33. RIDER OFD -> status ${ofdS.status}`);

  const fd2 = new FormData();
  fd2.append('file', new Blob([png], { type: 'image/png' }), 'pod.png');
  const up2 = await (await fetch(`${BASE}/api/v1/uploads?kind=pod_stamp`, { method: 'POST', headers: { authorization: `Bearer ${driverToken}` }, body: fd2 })).json();
  await api(`/api/v1/shipments/${rAwb}/pod`, { method: 'POST', token: driverToken, body: { gpsLat: 13.06, gpsLng: 80.25, piecesDelivered: 1, stampPhotoUrl: up2.url } });
  const finalS = await api(`/api/v1/shipments/${rAwb}`, { token: adminToken });
  log(`34. RIDER DELIVERED ${rAwb} -> status ${finalS.status}, POD photo ${finalS.pods?.[0]?.stampPhotoUrl}`);

  log('\n=== smoke test complete ===');
})().catch((e) => { console.error('SMOKE TEST FAILED:', e.message); process.exit(1); });
