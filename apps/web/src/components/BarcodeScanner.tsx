import { useEffect, useRef, useState } from 'react';

/**
 * 📷 button that scans a barcode with the device camera and returns the value.
 * Uses the native BarcodeDetector (Chrome / Android — the usual warehouse device).
 * Hardware USB/Bluetooth scanners don't need this — they type straight into the field.
 */
export function ScanButton({ onScan, title }: { onScan: (code: string) => void; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="secondary" title={title || 'Scan with camera'} onClick={() => setOpen(true)}
        style={{ padding: '0 12px', fontSize: 16, flex: '0 0 auto' }}>📷</button>
      {open && <ScannerModal onClose={() => setOpen(false)} onScan={(c) => { onScan(c); setOpen(false); }} />}
    </>
  );
}

function ScannerModal({ onScan, onClose }: { onScan: (code: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0; let stopped = false;
    const Detector = (window as any).BarcodeDetector;
    (async () => {
      if (!Detector) { setErr("Camera scanning isn't supported on this browser. Use a USB/Bluetooth scanner (it types straight into the field), or type the number. Tip: Chrome on Android supports the camera scanner."); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream; await v.play();
        const detector = new Detector();
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(v);
            const val = codes && codes.length ? String(codes[0].rawValue || '').trim() : '';
            if (val) { onScan(val.toUpperCase()); return; }
          } catch { /* transient frame error — keep scanning */ }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setErr('Could not open the camera. Allow camera access for this site, or use a scanner / type it.');
      }
    })();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onScan]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 440, width: '92%' }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong>📷 Scan barcode</strong>
          <button className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={onClose}>✕</button>
        </div>
        {err
          ? <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>{err}</div>
          : <video ref={videoRef} style={{ width: '100%', borderRadius: 8, background: '#000', aspectRatio: '4 / 3', objectFit: 'cover' }} muted playsInline />}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Point the camera at the AWB / forwarding barcode. It captures automatically.</p>
      </div>
    </div>
  );
}
