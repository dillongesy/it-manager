// Work-order status labels and badge colors — one source of truth, because these
// maps were previously copy-pasted across six files and a new status meant six edits
// (and a silent blank badge wherever one was missed).
//
//   draft           → not yet submitted
//   pending_billing → waiting on the biller
//   invoiced        → sent to the customer
//   paid            → money received
//   voided          → cancelled, out of the Billing Queue, kept on the list as a record

export const WO_STATUS_LABEL = {
  draft:           'Draft',
  pending_billing: 'Pending Billing',
  invoiced:        'Invoiced',
  paid:            'Paid',
  voided:          'Voided',
};

export const WO_STATUS_BADGE = {
  draft:           'bg-surface-500 text-gray-400',
  pending_billing: 'bg-amber-900/40 text-amber-400',
  invoiced:        'bg-blue-900/40 text-blue-400',
  paid:            'bg-green-900/40 text-green-400',
  voided:          'bg-red-900/40 text-red-400',
};

// Filter chips on the Work Orders page, in lifecycle order.
export const WO_STATUS_FILTERS = [
  { value: '',                label: 'All' },
  { value: 'draft',           label: 'Draft' },
  { value: 'pending_billing', label: 'Pending Billing' },
  { value: 'invoiced',        label: 'Invoiced' },
  { value: 'paid',            label: 'Paid' },
  { value: 'voided',          label: 'Voided' },
];

export function woStatusLabel(status) {
  return WO_STATUS_LABEL[status] ?? status;
}
