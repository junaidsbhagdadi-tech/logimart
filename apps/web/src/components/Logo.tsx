/**
 * Logimart brand mark — inline SVG (globe + plane + truck + wordmark), so branding
 * always renders and never falls back to another company's artwork.
 * TODO(logimart): when the real Logimart logo is available, drop it into
 * apps/web/public/logo.png and switch this back to an <img src="/logo.png"> variant.
 */
export function Logo({ height = 44, variant = 'dark' }: { height?: number; variant?: 'dark' | 'light' }) {
  const navy = variant === 'light' ? '#ffffff' : '#13266b';
  const sky = '#7ec5e6';

  return (
    <svg height={height} viewBox="0 0 220 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Logimart">
      <circle cx="92" cy="46" r="40" fill={sky} opacity="0.55" />
      <path d="M58 60 q34 -34 70 -20" stroke={navy} strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M120 36 l18 -10 -6 12 8 2 -14 8z" fill={navy} />
      <rect x="64" y="62" width="34" height="16" rx="2" fill={navy} />
      <path d="M98 66 h14 l8 8 v4 h-22z" fill={navy} />
      <circle cx="74" cy="82" r="5" fill={navy} /><circle cx="74" cy="82" r="2" fill="#fff" />
      <circle cx="112" cy="82" r="5" fill={navy} /><circle cx="112" cy="82" r="2" fill="#fff" />
      <text x="110" y="112" textAnchor="middle" fontFamily="'Plus Jakarta Sans', sans-serif" fontWeight="800" fontSize="26" fill={navy}>
        Logimart
      </text>
    </svg>
  );
}
