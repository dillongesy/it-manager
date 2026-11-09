// Build a clean, printable HTML view of a work order and send it to the printer.
// This intentionally renders a light, document-style layout in a separate window
// (not the dark app UI) and OMITS all internal-only fields: travel time, remote
// flag, follow-up notes, and internal notes never appear on the customer copy.

import { cadenceLabel, cadenceUnit } from '../utils/cadence.js';
import { printBrandHeader, printBrandFooter, printBrandVars } from './printBranding.js';

export const money = (v) => `$${parseFloat(v || 0).toFixed(2)}`;

// "/mo", "/yr", "/3yr". This prints on the CUSTOMER'S invoice, so a service sold in a
// multi-year term has to say so instead of reading as a plain annual charge.
const recurSuffix = (sv) => `/${cadenceUnit(sv.recurrence, sv.recurrence_count)}`;

export const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// work_date is a DATE column that arrives as a UTC-anchored ISO string
// (e.g. "2026-07-07T00:00:00.000Z"). Parsing it with `new Date()` and formatting
// in a US (UTC-negative) timezone rolls it back a day. Take the calendar date
// portion and build a local Date so the printed day matches what the tech entered.
export const fmtDate = (d) => {
  if (!d) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString();
  return new Date(d).toLocaleDateString();
};

function locationBlock(wo) {
  const name = wo.location_label || wo.location_business_name;
  if (!name && !wo.location_address) return '';
  const parts = [];
  if (name) parts.push(esc(name));
  if (wo.location_address) {
    const cityLine = [wo.location_city, wo.location_state].filter(Boolean).join(', ');
    parts.push(esc([wo.location_address, cityLine, wo.location_zip].filter(Boolean).join(', ')));
  }
  return `<div class="muted">Branch: ${parts.join(' — ')}</div>`;
}

function sectionHtml(s, index, defaultRateLabel) {
  const techs = (s.technicians ?? []).map((t) => esc(t.full_name)).join(', ');
  const rateLabel = s.effective_rate_label || defaultRateLabel || '';
  const hours = s.hours != null ? parseFloat(s.hours) : 0;

  // Meta grid - always rendered with consistent column positions.
  const hoursCell = String(hours);
  const laborCell = money(s.labor_total);

  const metaGrid = `
    <div class="meta-grid">
      <div><span class="label">Technician(s):</span> ${techs || '—'}</div>
      <div><span class="label">Hours (all techs):</span> ${hoursCell}</div>
      <div><span class="label">Rate:</span> ${rateLabel ? `${esc(rateLabel)}${s.effective_rate != null ? ` (${money(s.effective_rate)}/hr)` : ''}` : '—'}</div>
      <div><span class="label">Labor:</span> ${laborCell}</div>
    </div>`;

  const partRows = (s.items ?? []).map((it) => {
    const qty = parseFloat(it.quantity);
    const showEach = it.unit_price != null && qty > 1;
    const amount = it.total_price != null
      ? (showEach ? `<span class="price-each">${money(it.unit_price)} ea ·</span> ${money(it.total_price)}` : money(it.total_price))
      : '—';
    return `
    <tr>
      <td>${esc(it.description)}${it.part_number ? ` <span class="muted">(P/N: ${esc(it.part_number)})</span>` : ''}</td>
      <td class="num">${qty}</td>
      <td class="num">${amount}</td>
    </tr>`;
  }).join('');

  const serviceRows = (s.services ?? []).map((sv) => {
    const recurring = sv.billing_type === 'recurring';
    const suffix = recurring ? recurSuffix(sv) : '';
    const tag = recurring ? `Recurring · ${cadenceLabel(sv.recurrence, sv.recurrence_count)}` : 'One-time';
    const qty = parseFloat(sv.quantity);
    const showEach = sv.unit_price != null && qty > 1;
    const amount = sv.total_price != null
      ? (showEach ? `<span class="price-each">${money(sv.unit_price)}${suffix} ea ·</span> ${money(sv.total_price)}${suffix}` : `${money(sv.total_price)}${suffix}`)
      : '—';
    return `
      <tr>
        <td>${esc(sv.description)} <span class="muted">(${tag})</span></td>
        <td class="num">${qty}</td>
        <td class="num">${amount}</td>
      </tr>`;
  }).join('');

  return `
    <div class="section">
      <div class="section-head">
        <strong>Work Section ${index + 1}</strong>
        <span class="muted">${fmtDate(s.work_date)}</span>
      </div>
      ${s.description ? `<p class="work">${esc(s.description).replace(/\n/g, '<br>')}</p>` : ''}
      ${metaGrid}
      ${(partRows || serviceRows) ? `
        <table class="lines">
          <thead><tr><th>Parts &amp; Services</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead>
          <tbody>${partRows}${serviceRows}</tbody>
        </table>` : ''}
    </div>`;
}

// The document-style CSS shared by the single-WO printout and the combined customer
// export. Exported (without <style> tags) so the export can include it once and append
// many work orders under the same rules.
export const WO_PRINT_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; margin: 32px; font-size: 13px; line-height: 1.45; }
  .brand { font-size: 20px; font-weight: 700; }
  .brand small { display:block; font-size: 11px; color:#555; font-weight: 400; letter-spacing: .03em; }
  .brand-block { display:flex; align-items:center; gap:12px; }
  .logo { height: 56px; width:auto; border-radius:4px; }
  .top { display:flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid var(--print-brand); padding-bottom: 12px; margin-bottom: 16px; }
  .wo-no { text-align: right; }
  .wo-no .num { font-size: 18px; font-weight: 700; }
  /* A voided WO must never print looking like a live invoice. */
  .voided-stamp { display: inline-block; margin-top: 4px; padding: 1px 8px; border: 2px solid #c00;
                  color: #c00; font-weight: 800; font-size: 12px; letter-spacing: 2px; border-radius: 3px; }
  .muted { color: #666; font-weight: 400; }
  .label { color: #888; }
  .parties { display:flex; justify-content: space-between; gap: 24px; margin-bottom: 18px; }
  .parties h3 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color:#888; }
  .section { border: 1px solid #ddd; border-radius: 6px; padding: 12px 14px; margin-bottom: 12px; page-break-inside: avoid; }
  .section-head { display:flex; justify-content: space-between; border-bottom: 1px solid #eee; padding-bottom: 6px; margin-bottom: 8px; }
  .work { white-space: pre-wrap; margin: 6px 0 10px; }
  table { width: 100%; border-collapse: collapse; }
  .meta-grid { display: grid; grid-template-columns: 1.7fr 1.4fr 1.7fr 1fr; gap: 3px 14px; font-size: 12px; margin: 4px 0 8px; }
  table.lines { margin-top: 8px; }
  table.lines th, table.lines td { text-align: left; padding: 5px 6px; border-bottom: 1px solid #eee; font-size: 12px; }
  .num { text-align: right; }
  .totals { width: 280px; margin-left: auto; margin-top: 16px; }
  .totals td { padding: 4px 6px; border-bottom: 1px solid #eee; }
  .totals tr.grand td { font-weight: 700; border-top: 2px solid #333; border-bottom: none; font-size: 14px; }
  .totals.recurring { margin-top: 10px; }
  .totals.recurring th { text-align:left; font-size: 11px; text-transform: uppercase; color:#888; padding: 4px 6px; border-bottom: 1px solid #ccc; }
  .price-each { color: #999; font-size: 11px; }
  .foot { margin-top: 28px; padding-top: 10px; border-top: 1px solid #eee; color:#888; font-size: 11px; text-align: center; }
  .proposals-block { margin-top: 12px; margin-bottom: 16px; page-break-inside: avoid; }
  .proposals-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #888; margin-bottom: 6px; }
  .proposal-card { border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; margin-bottom: 8px; display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .proposal-card-label { font-size: 11px; font-weight: 700; color: var(--print-brand); white-space: nowrap; min-width: 72px; }
  .proposal-card-name { font-size: 12px; color: #1a1a1a; flex: 1; }
  .proposal-card-price { font-size: 12px; font-weight: 600; color: #1a1a1a; white-space: nowrap; }
  /* EVERY attached proposal starts on a fresh page - this used to be .first-proposal,
     so proposals 2, 3… ran straight on from the previous one's last page. */
  .proposal-section { page-break-before: always; break-before: page; }
  .proposal-header { font-size: 11px; color: #888; border-bottom: 1px solid #eee; padding-bottom: 4px; margin-bottom: 8px; }
  /* Keep a rendered PDF page whole rather than splitting it across two sheets. */
  .proposal-page { display: block; width: 100%; max-width: 100%; margin-bottom: 2px;
                   page-break-inside: avoid; break-inside: avoid; }
  @media print { body { margin: 12mm; } }
`;

// Build the inner <body> content for one work order (header, customer, sections,
// proposals summary, totals, and any pre-rendered proposal pages). Returned as an
// HTML string so both printWorkOrder and the combined customer export can reuse it.
// proposalImages: array of { name, pages: string[] } (JPEG data URLs).
export function renderWorkOrderBody(wo, proposalImages = []) {
  const woNum = `WO-${String(wo.number).padStart(5, '0')}`;
  const defaultRateLabel = wo.billing_rate_label || '';
  const custAddr = [wo.customer_address, [wo.customer_city, wo.customer_state].filter(Boolean).join(', ')]
    .filter(Boolean).join(' — ');

  const sectionsHtml = (wo.sections ?? []).map((s, i) => sectionHtml(s, i, defaultRateLabel)).join('');

  const woProposalsTotal = (wo.wo_proposals ?? [])
    .reduce((sum, p) => sum + (p.price_excl_tax != null ? parseFloat(p.price_excl_tax) : 0), 0);
  const printGrandTotal = (wo.grand_total || 0) + woProposalsTotal;

  const totalsRows = [
    wo.labor_total > 0 ? `<tr><td>Labor</td><td class="num">${money(wo.labor_total)}</td></tr>` : '',
    wo.hardware_total > 0 ? `<tr><td>Parts</td><td class="num">${money(wo.hardware_total)}</td></tr>` : '',
    wo.services_onetime_total > 0 ? `<tr><td>Services (one-time)</td><td class="num">${money(wo.services_onetime_total)}</td></tr>` : '',
    woProposalsTotal > 0 ? `<tr><td>Proposals / Estimates</td><td class="num">${money(woProposalsTotal)}</td></tr>` : '',
    `<tr class="grand"><td>Total</td><td class="num">${money(printGrandTotal)}</td></tr>`,
  ].join('');

  const recurring = wo.recurring_services ?? [];
  const recurringHtml = recurring.length ? `
    <table class="totals recurring">
      <thead><tr><th colspan="2">Recurring charges</th></tr></thead>
      <tbody>${recurring.map((sv) => `
        <tr><td>${sv.quantity > 1 ? `&times;${sv.quantity} ` : ''}${esc(sv.description)}</td><td class="num">${money(sv.unit_price)}${recurSuffix(sv)}</td></tr>`).join('')}
      </tbody>
    </table>` : '';

  // Proposals summary cards - shown inline after sections, before totals.
  const woProposals = wo.wo_proposals ?? [];
  const proposalsSummaryHtml = woProposals.length ? `
    <div class="proposals-block">
      <div class="proposals-title">Proposals</div>
      ${woProposals.map((p, i) => `
        <div class="proposal-card">
          <div class="proposal-card-label">Proposal ${i + 1}</div>
          <div class="proposal-card-name">${esc(p.proposal_name || 'Unnamed proposal')}</div>
          ${p.price_excl_tax != null ? `<div class="proposal-card-price">${money(p.price_excl_tax)} <span class="muted">excl. tax</span></div>` : ''}
        </div>`).join('')}
    </div>` : '';

  const proposalPagesHtml = proposalImages.map((p) => `
    <div class="proposal-section">
      <div class="proposal-header">Proposal: ${esc(p.name)}</div>
      ${p.pages.map((dataUrl) => `<img src="${dataUrl}" class="proposal-page" alt="">`).join('')}
    </div>`).join('');

  return `
  <div class="top">
    ${printBrandHeader()}
    <div class="wo-no">
      <div class="num">${woNum}</div>
      <div class="muted">Date: ${fmtDate(wo.work_date)}</div>
      ${wo.status === 'voided' ? '<div class="voided-stamp">VOIDED</div>' : ''}
    </div>
  </div>

  <div class="parties">
    <div>
      <h3>Customer</h3>
      <div><strong>${esc(wo.customer_name)}</strong></div>
      ${custAddr ? `<div class="muted">${esc(custAddr)}</div>` : ''}
      ${wo.customer_phone ? `<div class="muted">${esc(wo.customer_phone)}</div>` : ''}
      ${locationBlock(wo)}
    </div>
  </div>

  ${sectionsHtml}
  ${proposalsSummaryHtml}

  <table class="totals">${totalsRows}</table>
  ${recurringHtml}
  ${printBrandFooter()}
  ${proposalPagesHtml}`;
}

// proposalImages: array of { name: string, pages: string[] } where pages are JPEG data URLs.
// Pre-render proposal PDFs to images (via pdfToImages util) before calling this function.
// options.autoPrint (default true): when false, the document just opens in a new tab
// (no automatic print dialog) - used for the Billing Queue "open invoice" button.
// Opening the print dialog the moment the document loads raced the proposal pages:
// they are large data: URLs, and a dialog opened before they decode prints blank (or
// omits them entirely). This waits for every image to settle first, with a ceiling so
// a stuck image can never leave the window refusing to print.
export const PRINT_WHEN_READY = `<script>
(function () {
  function whenImagesReady(done) {
    var pending = Array.prototype.slice.call(document.images).filter(function (i) { return !i.complete; });
    if (!pending.length) return done();
    var left = pending.length, fired = false;
    var finish = function () { if (!fired) { fired = true; done(); } };
    var one = function () { if (--left <= 0) finish(); };
    pending.forEach(function (i) { i.addEventListener('load', one); i.addEventListener('error', one); });
    setTimeout(finish, 20000);
  }
  function start() { whenImagesReady(function () { setTimeout(function () { window.print(); }, 60); }); }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
<\/script>`;

export function printWorkOrder(wo, proposalImages = [], { autoPrint = true } = {}) {
  const woNum = `WO-${String(wo.number).padStart(5, '0')}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${woNum} — ${esc(wo.customer_name)}</title>
<style>${printBrandVars()}${WO_PRINT_STYLES}</style></head>
<body>
  ${renderWorkOrderBody(wo, proposalImages)}
  ${autoPrint ? PRINT_WHEN_READY : ''}
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups to print the work order.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
