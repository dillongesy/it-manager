import { useState } from 'react';
import { useBranding } from '../contexts/BrandingContext.jsx';

// Company logo from the Portal's Admin → Branding (pushed over the bridge).
// Falls back to the company initials on a brand-colored tile.
//   variant="badge" → square mark (header)
//   variant="full"  → whole lockup (login hero)
function initialsOf(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 3).toUpperCase() || '•';
}

export function Logo({ variant = 'badge', className = '', size = 28 }) {
  const { companyName, assets } = useBranding();
  const src = variant === 'full' ? (assets.logo_full || assets.logo) : (assets.logo || assets.logo_full);
  const [failedSrc, setFailedSrc] = useState(null);

  if (!src || failedSrc === src) {
    const text = initialsOf(companyName);
    return (
      <div className={`bg-brand rounded${variant === 'full' ? '-xl' : ''} flex items-center justify-center shrink-0 ${className}`}
        style={{ width: size, height: size }}>
        <span className="text-on-brand font-bold leading-none" style={{ fontSize: size * (text.length > 2 ? 0.28 : 0.36) }}>{text}</span>
      </div>
    );
  }

  if (variant === 'full') {
    return <img src={src} alt={companyName} className={`rounded-lg ${className}`} onError={() => setFailedSrc(src)} />;
  }
  return (
    <img src={src} alt={companyName} className={`rounded-sm object-contain shrink-0 ${className}`}
      style={{ width: size, height: size }} onError={() => setFailedSrc(src)} />
  );
}
