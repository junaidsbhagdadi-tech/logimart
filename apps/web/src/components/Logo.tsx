import { useState } from 'react';

/**
 * LogiMart brand lockup. Prefers the real logo if you drop it at
 * apps/web/public/logo.png; otherwise renders an inline SVG (stacked cargo
 * boxes + two-tone "LogiMart" wordmark + "Logistics simplified" tagline).
 */
export function Logo({ height = 44, variant = 'dark' }: { height?: number; variant?: 'dark' | 'light' }) {
  const [imgOk, setImgOk] = useState(true);
  const light = variant === 'light';
  const navy = light ? '#ffffff' : '#0c1e16';
  const green = light ? '#d6ffe8' : '#0ea26b';
  const teal = light ? 'rgba(255,255,255,.82)' : '#0891b2';

  if (imgOk) {
    return (
      <img
        src="/logo.png"
        alt="LogiMart"
        onError={() => setImgOk(false)}
        style={{ height, width: 'auto', display: 'block' }}
      />
    );
  }

  return (
    <svg height={height} viewBox="0 0 344 96" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="LogiMart — Logistics simplified">
      {/* stacked cargo boxes → ascending growth */}
      <rect x="10" y="58" width="18" height="26" rx="4" fill={light ? 'rgba(255,255,255,.55)' : '#0c1e16'} />
      <rect x="31" y="44" width="18" height="40" rx="4" fill={light ? 'rgba(255,255,255,.78)' : teal} />
      <rect x="52" y="28" width="18" height="56" rx="4" fill={light ? '#ffffff' : '#34c46e'} />
      {/* wordmark */}
      <text x="86" y="56" fontFamily="'Space Grotesk','Manrope',sans-serif" fontWeight="700" fontSize="38" letterSpacing="-1">
        <tspan fill={navy}>Logi</tspan><tspan fill={green}>Mart</tspan>
      </text>
      {/* tagline */}
      <text x="88" y="79" fontFamily="'Manrope',sans-serif" fontStyle="italic" fontWeight="600" fontSize="14" letterSpacing="1.2" fill={green}>
        Logistics simplified
      </text>
    </svg>
  );
}
