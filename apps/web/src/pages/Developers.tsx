import { Link } from 'react-router-dom';

// Public API reference for customers' developers and for our own websites (logimart.co.in, Tuvas).
// Reachable without login at /developers. Keys are issued by Logimart (Customer 360 → API access).
const BASE = 'https://erp.logimart.co.in';

const BOOK_BODY = `{
  "referenceNo": "ORD-10045",
  "product": "SFC",
  "paymentTerm": "PREPAID",
  "shipper":   { "name": "Acme Pvt Ltd", "phone": "9810000000", "address1": "Plot 12, Sector 63", "pincode": "201301", "city": "Noida" },
  "consignee": { "name": "Rahul Store", "phone": "9820000000", "address": "Shop 4, MG Road", "pincode": "400001", "city": "Mumbai" },
  "invoice":   { "no": "INV-778", "value": 42000, "ewbNo": "" },
  "goodsDesc": "Garments",
  "pieces": [ { "weightKg": 12.5, "lengthCm": 40, "widthCm": 30, "heightCm": 30 },
              { "weightKg": 8 } ]
}`;

const WIDGET = `<!-- Logimart tracking box — paste anywhere on your website -->
<form id="lm-track" style="display:flex;gap:8px">
  <input id="lm-awb" placeholder="AWB / reference no" required>
  <button>Track</button>
</form>
<div id="lm-result"></div>
<script>
document.getElementById('lm-track').onsubmit = async (e) => {
  e.preventDefault();
  const awb = document.getElementById('lm-awb').value.trim();
  const out = document.getElementById('lm-result');
  out.textContent = 'Loading…';
  const r = await fetch('${BASE}/api/v1/track/' + encodeURIComponent(awb));
  if (!r.ok) { out.textContent = 'Shipment not found.'; return; }
  const t = await r.json();
  out.innerHTML = '<b>' + t.awb + '</b> — ' + t.currentLabel +
    '<br>' + t.origin + ' → ' + t.destination +
    '<ul>' + t.timeline.slice().reverse().map(x =>
      '<li>' + new Date(x.at).toLocaleString('en-IN') + ' — ' + x.label + (x.location ? ' (' + x.location + ')' : '') + '</li>').join('') + '</ul>';
};
</script>`;

const pre: React.CSSProperties = { background: 'var(--bg-soft, #f4f6f8)', padding: 12, borderRadius: 6, overflowX: 'auto', fontSize: 12.5, lineHeight: 1.5 };

function Endpoint({ method, path, auth, children }: { method: string; path: string; auth: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--border, #e3e6ea)', paddingTop: 14, marginTop: 14 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`badge ${method === 'GET' ? 'DELIVERED' : 'CREATED'}`}>{method}</span>
        <code style={{ fontSize: 14, fontWeight: 700 }}>{path}</code>
        <span className="muted" style={{ fontSize: 12 }}>{auth}</span>
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

export function Developers() {
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 16px' }}>
      <h1 style={{ marginBottom: 4 }}>Logimart API</h1>
      <p className="muted" style={{ marginTop: 0 }}>Book, track and cancel shipments from your own system. Base URL <code>{BASE}</code></p>

      <div className="card">
        <h2>Getting access</h2>
        <ol style={{ lineHeight: 1.8, margin: 0 }}>
          <li>Ask your Logimart account manager for API access. We issue a key for your customer account.</li>
          <li>Send it on every call as the header <code>x-api-key: lm_…</code>. Keep it on your server — never in a web page or mobile app.</li>
          <li>Call <code>GET /api/ext/v1/ping</code> to check the key. If a key leaks, ask us to rotate it; the old one stops working immediately.</li>
        </ol>
        <p className="muted" style={{ fontSize: 13, marginBottom: 0 }}>Every call only sees shipments of the account the key belongs to. Errors come back as JSON <code>{'{ "statusCode": 400, "message": "…" }'}</code>; 401 = missing/invalid key.</p>
      </div>

      <div className="card">
        <h2>Customer API</h2>

        <Endpoint method="GET" path="/api/ext/v1/ping" auth="x-api-key">
          Returns the account the key belongs to.
          <pre style={pre}>{`curl ${BASE}/api/ext/v1/ping -H "x-api-key: YOUR_KEY"`}</pre>
        </Endpoint>

        <Endpoint method="POST" path="/api/ext/v1/shipments" auth="x-api-key">
          Book a shipment. <b>product</b>: <code>SFC</code> surface, <code>APEX</code> air cargo, <code>DP</code> domestic courier (others as agreed in your rate card).
          <b> paymentTerm</b>: <code>PREPAID</code> (default) or <code>TO_PAY</code> with <code>freightToCollect</code>. One entry in <b>pieces</b> per box.
          Re-sending the same <code>referenceNo</code> is refused, so retries never double-book.
          <pre style={pre}>{`curl -X POST ${BASE}/api/ext/v1/shipments \\
  -H "x-api-key: YOUR_KEY" -H "Content-Type: application/json" \\
  -d '${BOOK_BODY.replace(/\n\s*/g, ' ')}'`}</pre>
          Body, formatted:
          <pre style={pre}>{BOOK_BODY}</pre>
          Response:
          <pre style={pre}>{`{ "awb": "L1000004512", "referenceNo": "ORD-10045", "product": "SFC", "pieces": 2,
  "expectedDelivery": "2026-11-03T00:00:00.000Z", "status": "MAN",
  "trackUrl": "${BASE}/track/L1000004512" }`}</pre>
        </Endpoint>

        <Endpoint method="GET" path="/api/ext/v1/shipments?search=&limit=" auth="x-api-key">
          Your shipments, newest first (max 500). <code>search</code> matches AWB, forwarding no, reference or consignee.
        </Endpoint>

        <Endpoint method="GET" path="/api/ext/v1/track/{awb}" auth="x-api-key">
          Full tracking for one of your shipments — by our AWB, the carrier forwarding no, your reference no or LR no.
        </Endpoint>

        <Endpoint method="POST" path="/api/ext/v1/shipments/{awb}/cancel" auth="x-api-key">
          Cancel before it moves (status booked / picked up). Body optional: <code>{'{ "reason": "Order cancelled" }'}</code>.
        </Endpoint>
      </div>

      <div className="card">
        <h2>Public tracking (websites)</h2>
        <p style={{ marginTop: 0 }}>No key needed — this is what the Logimart and Tuvas websites use. Limited to 60 lookups a minute per visitor.</p>

        <Endpoint method="GET" path="/api/v1/track/{awb}" auth="public">
          By AWB, forwarding no, reference no or LR no. Returns <code>awb</code>, <code>currentLabel</code>, <code>statusCode</code>, <code>origin</code>, <code>destination</code>,
          <code> pieceCount</code>, <code>expectedDelivery</code> and a <code>timeline</code> of <code>{'{ at, label, location }'}</code>.
        </Endpoint>
        <Endpoint method="POST" path="/api/v1/track/multi" auth="public">
          Up to 50 at once: <code>{'{ "awbs": ["L1000004512", "L1000004513"] }'}</code>
        </Endpoint>

        <h3 style={{ marginTop: 18 }}>Status codes</h3>
        <p style={{ fontSize: 13 }}><code>MAN</code> booked · <code>PKD</code> picked up · <code>ORD</code>/<code>DPD</code> in transit · <code>DRD</code> at destination · <code>OFD</code> out for delivery · <code>DLD</code> delivered · <code>UDL</code> undelivered · <code>RTO</code> returning · <code>RTD</code> returned · <code>CAN</code> cancelled</p>

        <h3>Tracking box for your website</h3>
        <pre style={pre}>{WIDGET}</pre>
        <p className="muted" style={{ fontSize: 13 }}>Or simply link to <code>{BASE}/track/AWB</code> — our hosted tracking page.</p>
      </div>
      <p className="muted" style={{ fontSize: 12 }}><Link to="/track">Track a shipment</Link></p>
    </div>
  );
}
