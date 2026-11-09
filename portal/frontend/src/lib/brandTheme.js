// Runtime white-labelling: turn the two brand colors from Admin → Branding into
// the CSS variables the Tailwind theme reads (rgb triplets), for both themes, and
// keep the browser tab title + icon in sync. Shared logic with the Field App.

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (rgb, target, t) => rgb.map((c, i) => clamp(c + (target[i] - c) * t));
const lighten = (rgb, t) => mix(rgb, [255, 255, 255], t);
const darken = (rgb, t) => mix(rgb, [0, 0, 0], t);
const triplet = (rgb) => rgb.join(' ');

// WCAG relative luminance + contrast ratio.
function luminance([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
export function contrastRatio(hexA, hexB) {
  const a = hexToRgb(hexA); const b = hexToRgb(hexB);
  if (!a || !b) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// Darken until the color reaches `ratio` against white (for light-mode text use).
function readableOnWhite(rgb, ratio = 4.5) {
  let c = rgb;
  for (let i = 0; i < 20 && (1.05 / (luminance(c) + 0.05)) < ratio; i++) c = darken(c, 0.1);
  return c;
}

/** The brand color as a hex string legible on white paper, or `fallback` if invalid. */
export function printableColor(hex, fallback = '#1D4ED8') {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  return `#${readableOnWhite(rgb).map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

export function applyBrandTheme({ primaryColor, accentColor } = {}) {
  const brand = hexToRgb(primaryColor);
  const accent = hexToRgb(accentColor);
  if (!brand || !accent) return;

  // Text on a brand-colored button: white unless the brand is very light.
  const onBrand = luminance(brand) > 0.45 ? [17, 17, 17] : [255, 255, 255];

  const css = `
:root, html.light {
  --c-brand: ${triplet(brand)};
  --c-brand-light: ${triplet(lighten(brand, 0.15))};
  --c-brand-dark: ${triplet(darken(brand, 0.25))};
  --c-on-brand: ${triplet(onBrand)};
}
:root { --c-accent: ${triplet(accent)}; --c-accent-dark: ${triplet(darken(accent, 0.2))}; }
html.light { --c-accent: ${triplet(readableOnWhite(accent))}; --c-accent-dark: ${triplet(darken(readableOnWhite(accent), 0.2))}; }
`;
  let el = document.getElementById('brand-theme');
  if (!el) {
    el = document.createElement('style');
    el.id = 'brand-theme';
    document.head.appendChild(el);
  }
  el.textContent = css;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', primaryColor);
}

export function applyDocumentBranding({ title, faviconUrl, appleTitle }) {
  if (title) document.title = title;
  if (appleTitle) document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', appleTitle);
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  const href = faviconUrl || '/favicon.svg';
  if (link.getAttribute('href') !== href) {
    link.removeAttribute('type');      // uploaded icons may be PNG / ICO, not SVG
    link.setAttribute('href', href);
  }
}
