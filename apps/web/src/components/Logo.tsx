import { useState } from 'react';

/**
 * ExcelEx Express brand lockup. Prefers the real logo if you drop it at
 * apps/web/public/logo.png; otherwise renders an inline SVG — the blue swoosh
 * "e" with a green rising arrow, plus the "ExcelEx Express · Logistics LLP" wordmark.
 */
export function Logo({ height = 44, variant = 'dark' }: { height?: number; variant?: 'dark' | 'light' }) {
  const [imgOk, setImgOk] = useState(true);
  const light = variant === 'light';
  const ink = light ? '#ffffff' : '#16296b';
  const inkSoft = light ? 'rgba(255,255,255,.85)' : '#2f5fbf';

  if (imgOk) {
    return (
      <img
        src="/logo.png"
        alt="ExcelEx Express Logistics LLP"
        onError={() => setImgOk(false)}
        style={{ height, width: 'auto', display: 'block' }}
      />
    );
  }

  const blueA = light ? 'rgba(255,255,255,.9)' : '#3e6be0';
  const blueB = light ? 'rgba(255,255,255,.65)' : '#16308f';
  const greenA = light ? '#d6ffe8' : '#6fbe45';
  const greenB = light ? '#a9f0c0' : '#3f8a28';

  return (
    <svg height={height} viewBox="0 0 340 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="ExcelEx Express Logistics LLP">
      <defs>
        <linearGradient id="ex-bl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={blueA} /><stop offset="1" stopColor={blueB} /></linearGradient>
        <linearGradient id="ex-gr" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor={greenA} /><stop offset="1" stopColor={greenB} /></linearGradient>
      </defs>
      {/* mark: blue swoosh "e" + green rising arrow */}
      <path d="M64 66a24 24 0 1 0-6 8" stroke="url(#ex-bl)" strokeWidth="9.5" strokeLinecap="round" fill="none" />
      <path d="M26 60c16 2 26-8 38-30" stroke="url(#ex-gr)" strokeWidth="9.5" strokeLinecap="round" fill="none" />
      <path d="M57 22l16-2-2 16z" fill={light ? '#bff0c6' : '#4f9e30'} />
      {/* wordmark */}
      <text x="98" y="50" fontFamily="'Sora','Space Grotesk',sans-serif" fontWeight="800" fontSize="30" letterSpacing="-.5" fill={ink}>ExcelEx Express</text>
      <text x="99" y="74" fontFamily="'Plus Jakarta Sans',sans-serif" fontWeight="700" fontSize="14" letterSpacing="1.5" fill={inkSoft}>LOGISTICS LLP</text>
    </svg>
  );
}
