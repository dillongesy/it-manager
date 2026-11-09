// Which office a work-order list row bills to. The list API returns the branch's
// name (`location_name`, NULL = main office) and whether the customer has any
// branches at all — "Main office" only means something for a customer that has
// more than one, so a single-office customer shows a dash instead.
export function woLocationLabel(wo) {
  if (wo.location_name) return wo.location_name;
  return wo.customer_has_branches ? 'Main office' : null;
}
