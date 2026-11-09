// Branded header / footer for the print windows (work orders, customer exports).
// The print window opens as about:blank, so image URLs must be absolute.
import { getBranding } from '../contexts/BrandingContext.jsx';
import { printableColor } from './brandTheme.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const abs = (url) => (url ? new URL(url, window.location.origin).href : null);

/** CSS custom properties for print stylesheets: `--print-brand` is the primary brand color. */
export function printBrandVars() {
  return `:root { --print-brand: ${printableColor(getBranding().primaryColor)}; }`;
}

export function printBrandHeader() {
  const b = getBranding();
  const logo = abs(b.assets?.logo_full || b.assets?.logo);
  const contact = [b.phone, b.email, b.website].filter(Boolean).map(esc).join(' · ');
  return `
    <div class="brand-block">
      ${logo ? `<img class="logo" src="${esc(logo)}" alt="${esc(b.companyName)}" onerror="this.style.display='none'">` : ''}
      <div class="brand" style="color:${esc(b.primaryColor)}">
        ${esc(b.companyName)}
        ${b.address ? `<small>${esc(b.address)}</small>` : ''}
        ${contact ? `<small>${contact}</small>` : ''}
      </div>
    </div>`;
}

export function printBrandFooter() {
  const { printFooter } = getBranding();
  return printFooter ? `<div class="print-footer" style="margin-top:24px;padding-top:8px;border-top:1px solid #ddd;font-size:10px;color:#666;white-space:pre-line">${esc(printFooter)}</div>` : '';
}
