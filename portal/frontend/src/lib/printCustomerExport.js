// Build a single printable document for the "To Customer" export: an overview of
// the customer, summary lists (work orders, to-dos, proposals, licensing, billing),
// and then every selected work order's full printable page appended at the end.
// Reuses the work-order print styles + body renderer so appended WOs look identical
// to the normal single-WO printout. The browser's "Save as PDF" turns it into a PDF.

import { WO_PRINT_STYLES, renderWorkOrderBody, esc, money, fmtDate } from './printWorkOrder.js';
import { WO_STATUS_LABEL as STATUS_LABEL } from '../utils/woStatus.js';
import { cadenceLabel } from '../utils/cadence.js';
import { printBrandHeader } from './printBranding.js';
const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const EXPORT_STYLES = `
  .export-head { border-bottom: 2px solid #CC0000; padding-bottom: 12px; margin-bottom: 20px; }
  .export-head .brand-block { display:flex; align-items:center; gap:12px; }
  .export-head h1 { margin: 10px 0 2px; font-size: 22px; color: #1a1a1a; }
  .export-head .sub { color: #666; font-size: 12px; }
  .doc-section { margin-bottom: 22px; page-break-inside: avoid; }
  .doc-section h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #CC0000; border-bottom: 1px solid #eee; padding-bottom: 5px; margin: 0 0 10px; }
  .kv { display: grid; grid-template-columns: 180px 1fr; gap: 3px 12px; font-size: 12.5px; }
  .kv .k { color: #888; }
  .subhead { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color:#888; margin: 12px 0 5px; }
  table.data { width: 100%; border-collapse: collapse; margin-top: 4px; }
  table.data th { text-align: left; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; color: #888; border-bottom: 1px solid #ccc; padding: 5px 6px; }
  table.data td { font-size: 12px; padding: 5px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  table.data td.num, table.data th.num { text-align: right; }
  .done { color: #2b8a3e; font-weight: 600; }
  .pending { color: #b8860b; font-weight: 600; }
  .empty { color: #999; font-size: 12px; font-style: italic; }
  .wo-appended { page-break-before: always; }
  .append-intro { page-break-before: always; margin-bottom: 4px; }
  .append-intro h2 { font-size: 15px; color:#CC0000; border-bottom: 2px solid #CC0000; padding-bottom: 6px; }
`;

function overviewSection(customer) {
  const rows = [
    ['Business Name', customer.name],
    ['Address', [customer.address, [customer.city, customer.state].filter(Boolean).join(', '), customer.zip].filter(Boolean).join(', ')],
    ['Phone', customer.phone],
    ['Static WAN IP', customer.wan_ip],
    ['Firewall Mgmt', customer.firewall_link],
    ['Billing Contact', [customer.billing_contact_name, customer.billing_contact_email, customer.billing_contact_phone].filter(Boolean).join(' · ')],
    ['Notes', customer.notes],
  ].filter(([, v]) => v);

  const contacts = customer.contacts ?? [];
  const branches = customer.locations ?? [];
  const rates = customer.billing_rates ?? [];

  const contactsHtml = contacts.length ? `
    <div class="subhead">Contacts</div>
    <table class="data">
      <thead><tr><th>Name</th><th>Title</th><th>Phone</th><th>Email</th></tr></thead>
      <tbody>${contacts.map(c => `<tr>
        <td>${esc(c.name)}${c.is_primary ? ' <span class="muted">(primary)</span>' : ''}</td>
        <td>${esc(c.title)}</td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td></tr>`).join('')}</tbody>
    </table>` : '';

  const branchesHtml = branches.length ? `
    <div class="subhead">Branch Offices</div>
    <table class="data">
      <thead><tr><th>Label</th><th>Address</th><th>Phone</th><th>WAN IP</th></tr></thead>
      <tbody>${branches.map(b => `<tr>
        <td>${esc(b.label || b.business_name)}</td>
        <td>${esc([b.address, [b.city, b.state].filter(Boolean).join(', '), b.zip].filter(Boolean).join(', '))}</td>
        <td>${esc(b.phone)}</td><td>${esc(b.wan_ip)}</td></tr>`).join('')}</tbody>
    </table>` : '';

  const ratesHtml = rates.length ? `
    <div class="subhead">Billing Rates</div>
    <table class="data">
      <thead><tr><th>Label</th><th class="num">Rate</th><th>Notes</th></tr></thead>
      <tbody>${rates.map(r => `<tr>
        <td>${esc(r.label)}</td><td class="num">${money(r.rate)}/hr</td><td>${esc(r.notes)}</td></tr>`).join('')}</tbody>
    </table>` : '';

  return `
    <div class="doc-section">
      <h2>Overview</h2>
      <div class="kv">${rows.map(([k, v]) => `<div class="k">${esc(k)}</div><div>${esc(v)}</div>`).join('')}</div>
      ${contactsHtml}${branchesHtml}${ratesHtml}
    </div>`;
}

function workOrdersSection(workOrders, rangeLabel) {
  const body = workOrders.length ? workOrders.map(wo => {
    const total = parseFloat(wo.labor_total || 0) + parseFloat(wo.hardware_total || 0) + parseFloat(wo.proposals_total || 0);
    return `<tr>
      <td>WO-${String(wo.number).padStart(5, '0')}</td>
      <td>${fmtDate(wo.work_date)}</td>
      <td>${esc(wo.technicians || '—')}</td>
      <td>${esc(STATUS_LABEL[wo.status] || wo.status)}</td>
      <td class="num">${total > 0 ? money(total) : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" class="empty">No work orders in this range.</td></tr>`;

  return `
    <div class="doc-section">
      <h2>Work Orders${rangeLabel ? ` <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">(${esc(rangeLabel)})</span>` : ''}</h2>
      <table class="data">
        <thead><tr><th>#</th><th>Date</th><th>Technicians</th><th>Status</th><th class="num">Total</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

const TASK_STATUS = { open: 'Open', scheduled: 'Scheduled', in_progress: 'In progress', waiting: 'Waiting', done: 'Done' };

function todosSection(tasks) {
  const body = tasks.length ? tasks.map(t => `<tr>
      <td>${esc(t.title)}</td>
      <td class="${t.status === 'done' ? 'done' : 'pending'}">${TASK_STATUS[t.status] ?? t.status}</td>
    </tr>`).join('') : `<tr><td colspan="2" class="empty">No tasks.</td></tr>`;
  return `
    <div class="doc-section">
      <h2>Tasks</h2>
      <table class="data">
        <thead><tr><th>Item</th><th>Status</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function proposalsSection(proposals) {
  const body = proposals.length ? proposals.map(p => `<li>${esc(p.original_name)}</li>`).join('')
    : '<li class="empty">No proposals.</li>';
  return `
    <div class="doc-section">
      <h2>Proposals</h2>
      <ul style="margin:0;padding-left:20px;font-size:12.5px;">${body}</ul>
    </div>`;
}

function licensingSection(licenses) {
  const body = licenses.length ? licenses.map(l => {
    const renew = l.auto_renew
      ? `Auto-renew · ${cadenceLabel(l.renewal_interval, l.renewal_interval_count)}`
      : (l.renewal_date ? `Expires ${fmtDate(l.renewal_date)}` : '—');
    return `<tr>
      <td>${esc(l.program_name)}</td>
      <td>${esc(l.vendor)}</td>
      <td>${esc(l.version)}</td>
      <td>${esc(renew)}</td>
      <td>${esc(l.payment_method)}</td>
      <td>${esc(l.notes)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" class="empty">No licenses.</td></tr>`;
  return `
    <div class="doc-section">
      <h2>Licensing</h2>
      <table class="data">
        <thead><tr><th>Program</th><th>Vendor</th><th>Version</th><th>Renewal</th><th>Payment</th><th>Notes</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function billingSection(charges) {
  const active = charges.filter(c => c.is_active);
  const body = active.length ? active.map(c => `<tr>
      <td>${esc(c.description)}</td>
      <td>${esc(c.category)}</td>
      <td class="num">${c.quantity ?? ''}</td>
      <td class="num">${money(c.unit_price)}</td>
      <td class="num">${money(c.amount)}</td>
      <td>${esc(cadenceLabel(c.frequency, c.interval_count))}${c.billing_month ? ` · ${MONTHS[c.billing_month]}${c.billing_year ? ` ${c.billing_year}` : ''}` : ''}</td>
    </tr>`).join('') : `<tr><td colspan="6" class="empty">No recurring charges.</td></tr>`;
  return `
    <div class="doc-section">
      <h2>Recurring Billing</h2>
      <table class="data">
        <thead><tr><th>Description</th><th>Category</th><th class="num">Qty</th><th class="num">Unit</th><th class="num">Amount</th><th>Frequency</th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// data: { customer, workOrders, fullWorkOrders:[{wo, proposalImages}], todos, proposals,
//         licenses, recurringCharges, rangeLabel }
export function printCustomerExport(data) {
  const {
    customer, workOrders = [], fullWorkOrders = [], todos = [],
    proposals = [], licenses = [], recurringCharges = [], rangeLabel = '',
  } = data;

  const generated = new Date().toLocaleDateString();

  const appended = fullWorkOrders.length ? `
    <div class="append-intro"><h2>Work Order Details</h2></div>
    ${fullWorkOrders.map(({ wo, proposalImages }, i) =>
      `<div class="${i === 0 ? '' : 'wo-appended'}">${renderWorkOrderBody(wo, proposalImages)}</div>`).join('')}
  ` : '';

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(customer.name)} — Customer Export</title>
<style>${WO_PRINT_STYLES}${EXPORT_STYLES}</style></head>
<body>
  <div class="export-head">
    ${printBrandHeader()}
    <h1>${esc(customer.name)}</h1>
    <div class="sub">Customer Export · Generated ${generated}${rangeLabel ? ` · Work orders: ${esc(rangeLabel)}` : ''}</div>
  </div>

  ${overviewSection(customer)}
  ${workOrdersSection(workOrders, rangeLabel)}
  ${todosSection(todos)}
  ${proposalsSection(proposals)}
  ${licensingSection(licenses)}
  ${billingSection(recurringCharges)}
  ${appended}

  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups to generate the export.'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
