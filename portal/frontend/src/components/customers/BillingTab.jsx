import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Receipt, CalendarClock, Link2, Link2Off, CloudDownload, ShieldCheck, Cloud } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { TdSynnexImport } from './TdSynnexImport.jsx';
import { SeatSync } from './SeatSync.jsx';
import { MenuButton } from '../ui/MenuButton.jsx';
import { formatDate } from '../../utils/date.js';
import { serviceCatalogApi } from '../../api/serviceCatalog.js';
import { Modal } from '../ui/Modal.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { CategoryInput, UnitLabelInput } from '../ui/catalogSuggest.jsx';
import { OfficeFilterBar, OfficeSelect, OfficeBadge, useOfficeFilter, officeMatches, defaultOfficeFor } from '../ui/office.jsx';
import { SearchInput } from '../ui/SearchInput.jsx';
import { noAutofill } from '../ui/noAutofill.js';
import { matchesQuery } from '../../utils/search.js';
import { countLabel } from '../../utils/plural.js';
import {
  FREQUENCIES, FREQ_LABEL, MONTHS,
  nextDueFor, nextDueLabel, annualizedTotal, money,
  cadenceLabel, cadenceUnit, perYear, needsYearAnchor,
} from '../../utils/recurring.js';
import { CadenceSelect } from '../ui/CadenceSelect.jsx';
import { useIntegrations } from '../../hooks/useIntegrations.js';

// Service-catalog recurrence values → this tab's frequency values (only 'annual' differs).
const RECURRENCE_TO_FREQ = { monthly: 'monthly', quarterly: 'quarterly', semiannual: 'semiannual', annual: 'annually' };

// The frequency dropdown, as { value, label } for the shared cadence control.
const FREQ_OPTIONS = FREQUENCIES.map(v => ({ value: v, label: FREQ_LABEL[v] }));

// Category / unit-label pickers come from components/ui/catalogSuggest.jsx - they
// suggest values already entered on any service or any customer's charges (our own
// dropdown, not a native <datalist>, which Chrome overlays its autofill on).

// --- Add / Edit form ----------------------------------------------------------

function ChargeForm({ customerId, charge, locations, companyName, defaultLocationId, onClose, onSaved }) {
  const [form, setForm] = useState({
    description:   charge?.description   ?? '',
    category:      charge?.category      ?? '',
    quantity:      charge?.quantity      ?? 1,
    unit_price:    charge?.unit_price    ?? '',
    unit_label:    charge?.unit_label    ?? '',
    frequency:     charge?.frequency     ?? 'monthly',
    // How many periods between bills - 3 for a domain bought three years at a time.
    interval_count: charge?.interval_count ?? 1,
    billing_month: charge?.billing_month ?? new Date().getMonth() + 1,
    // A multi-year charge also needs a year: "November" alone can't say whether the
    // next renewal is 2027 or 2029. Ignored (and stored NULL) for every other cadence.
    billing_year:  charge?.billing_year  ?? new Date().getFullYear(),
    is_active:     charge?.is_active ?? true,
    location_id:   charge?.location_id   ?? defaultLocationId ?? '',
    notes:         charge?.notes         ?? '',
    // Which catalog service this charge tracks. Set by picking one below; that link
    // is what makes a catalog price change flow down to this customer automatically.
    service_catalog_id: charge?.service_catalog_id ?? '',
  });
  const [linkedName, setLinkedName] = useState(charge?.service_name ?? '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  // Service-catalog autocomplete on the description field - lets the biller pull a
  // service straight from the Services page (prefills name/price/frequency) so the only
  // thing left to set is the quantity (seats). Free-typing still works normally.
  const [matches, setMatches] = useState([]);
  const [showMatches, setShowMatches] = useState(false);
  const descRef = useRef(null);
  useEffect(() => {
    const q = form.description.trim();
    if (q.length < 1) { setMatches([]); return; }
    const t = setTimeout(async () => {
      try { const { data } = await serviceCatalogApi.list({ q }); setMatches(data || []); }
      catch { setMatches([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [form.description]);
  useEffect(() => {
    const onDoc = (e) => { if (descRef.current && !descRef.current.contains(e.target)) setShowMatches(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const pickService = (s) => {
    setForm(f => ({
      ...f,
      description: s.name,
      unit_price: s.unit_price != null ? String(s.unit_price) : f.unit_price,
      frequency: s.billing_type === 'recurring' && RECURRENCE_TO_FREQ[s.recurrence]
        ? RECURRENCE_TO_FREQ[s.recurrence] : f.frequency,
      interval_count: s.billing_type === 'recurring' ? (s.recurrence_count ?? 1) : 1,
      category:   s.category   || f.category,
      unit_label: s.unit_label || f.unit_label,
      service_catalog_id: s.id,
    }));
    setLinkedName(s.name);
    setMatches([]); setShowMatches(false);
  };

  // Typing over the description breaks the link - the charge is no longer "the M365
  // service", it's whatever was typed, and shouldn't follow that service's price.
  const onDescriptionChange = (v) => {
    setForm(f => ({ ...f, description: v, service_catalog_id: v === linkedName ? f.service_catalog_id : '' }));
    setShowMatches(true);
  };
  const unlink = () => setForm(f => ({ ...f, service_catalog_id: '' }));

  const periodic = form.frequency !== 'monthly';
  const multiYear = needsYearAnchor(form.frequency, form.interval_count);
  const lineTotal = (parseFloat(form.quantity) || 0) * (parseFloat(form.unit_price) || 0);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        billing_month: periodic ? form.billing_month : null,
        billing_year:  multiYear ? form.billing_year : null,
      };
      if (charge) await customersApi.recurringCharges.update(customerId, charge.id, payload);
      else        await customersApi.recurringCharges.create(customerId, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to save charge.');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="off" data-form-type="other">
      {error && <p className="text-red-400 text-sm bg-red-900/20 rounded-sm p-2">{error}</p>}

      <div ref={descRef} className="relative">
        <label className="block text-xs font-medium text-gray-400 mb-1">Description *</label>
        <input className="input" value={form.description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onFocus={() => setShowMatches(true)}
          placeholder="e.g. Microsoft 365 Business Standard, Cloud Backup" required autoFocus autoComplete="off" />
        {showMatches && matches.length > 0 && (
          <ul className="absolute z-30 left-0 right-0 mt-1 bg-surface-800 border border-surface-600 rounded-lg overflow-hidden shadow-xl max-h-56 overflow-y-auto">
            {matches.map(s => (
              <li key={s.id}>
                <button type="button" onMouseDown={(e) => { e.preventDefault(); pickService(s); }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-700 transition-colors flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-200 truncate">{s.name}</span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {s.unit_price != null ? money(s.unit_price) : ''}
                    {s.billing_type === 'recurring' ? ` /${cadenceUnit(RECURRENCE_TO_FREQ[s.recurrence], s.recurrence_count)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {form.service_catalog_id ? (
          <p className="text-xs text-blue-300 mt-1 flex items-center gap-1.5">
            <Link2 size={12} className="shrink-0" />
            Linked to the <span className="font-medium">{linkedName || 'Services'}</span> catalog price — a price
            change there updates this charge automatically.
            <button type="button" onClick={unlink} className="ml-1 text-gray-500 hover:text-gray-300 underline underline-offset-2">
              Unlink
            </button>
          </p>
        ) : (
          <p className="text-xs text-gray-600 mt-1">
            Start typing to pull from your <span className="text-gray-500">Services</span> catalog — price, category
            &amp; frequency fill in automatically, and the charge then follows that service's price.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Category</label>
          <CategoryInput value={form.category} onChange={(v) => setForm(f => ({ ...f, category: v }))}
            placeholder="Antivirus, Backup…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Unit label <span className="text-gray-600 font-normal">(optional)</span>
          </label>
          <UnitLabelInput value={form.unit_label} onChange={(v) => setForm(f => ({ ...f, unit_label: v }))} />
        </div>
      </div>

      {/* Quantity × per-each price → grand total */}
      <div>
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Quantity</label>
            <input className="input" {...noAutofill} type="number" step="0.01" min="0"
              value={form.quantity} onChange={set('quantity')} placeholder="1" />
          </div>
          <span className="text-gray-500 pb-2.5">×</span>
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Price per each</label>
            <input className="input" {...noAutofill} type="number" step="0.01" min="0"
              value={form.unit_price} onChange={set('unit_price')} placeholder="0.00" />
          </div>
          <div className="text-right pb-2.5">
            <span className="text-gray-500 text-xs">= </span>
            <span className="text-accent font-semibold">{money(lineTotal)}</span>
            <span className="text-gray-600 text-xs">/{cadenceUnit(form.frequency, form.interval_count)}</span>
          </div>
        </div>
        <p className="text-xs text-gray-600 mt-1">
          Grand total per charge = quantity × price per each{form.unit_label ? ` (e.g. ${countLabel(parseFloat(form.quantity) || 1, form.unit_label)})` : ''}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">Frequency</label>
          <CadenceSelect options={FREQ_OPTIONS} frequency={form.frequency} count={form.interval_count}
            onChange={({ frequency, count }) => setForm(f => ({ ...f, frequency, interval_count: count }))} />
        </div>
        {periodic && (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Billing month</label>
              <select className="input" value={form.billing_month} onChange={set('billing_month')}>
                {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            {/* Only a multi-year cycle needs a year to count from - every other
                cadence repeats within a single year, so the month places it. */}
            {multiYear && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1">Year</label>
                <input className="input w-24 text-center" {...noAutofill} type="number" step="1"
                  min="1900" max="9999" inputMode="numeric"
                  value={form.billing_year} onChange={set('billing_year')} />
              </div>
            )}
          </div>
        )}
      </div>
      {periodic && (
        <p className="text-xs text-gray-600 -mt-2">
          {multiYear
            ? `Bills in ${MONTHS[form.billing_month - 1]?.label} ${form.billing_year}, then every ${form.interval_count} years after that.`
            : form.frequency === 'annually'
              ? `Bills once a year in ${MONTHS[form.billing_month - 1]?.label}.`
              : `Anchored to ${MONTHS[form.billing_month - 1]?.label}; the next due date rolls forward automatically.`}
        </p>
      )}

      <OfficeSelect locations={locations} companyName={companyName}
        value={form.location_id} onChange={(v) => setForm(f => ({ ...f, location_id: v }))} />

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Notes</label>
        <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')}
          placeholder="How it's billed, PO reference, seat count…" />
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <input type="checkbox" className="h-4 w-4 accent-brand"
          checked={form.is_active} onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))} />
        <span className="text-sm text-gray-300">Active</span>
        <span className="text-xs text-gray-600">(inactive charges are kept for history but excluded from totals)</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <button type="submit" disabled={saving || !form.description.trim()} className="btn-primary">
          {saving ? 'Saving…' : charge ? 'Update Charge' : 'Add Charge'}
        </button>
      </div>
    </form>
  );
}

// --- Charge card --------------------------------------------------------------

function ChargeCard({ charge, locations, companyName, onEdit, onDelete }) {
  const due = nextDueFor(charge);
  const timesPerYear = perYear(charge.frequency, charge.interval_count);
  const qty = parseFloat(charge.quantity);
  const unitPrice = charge.unit_price == null || charge.unit_price === '' ? null : parseFloat(charge.unit_price);
  const hasTotal = charge.amount != null && charge.amount !== '';
  // Only show the "N units × $x" breakdown when it's more than a plain 1 × price.
  const showBreakdown = unitPrice != null && (qty !== 1 || charge.unit_label);
  // Linked to a catalog service → it tracks that service's price. If the two have
  // drifted apart (the biller declined the roll-out, or the link was made after the
  // fact) say so, rather than letting a stale price sit here unnoticed.
  const catalogPrice = charge.service_unit_price == null ? null : parseFloat(charge.service_unit_price);
  const outOfSync = charge.service_catalog_id && catalogPrice != null && unitPrice != null && catalogPrice !== unitPrice;
  const cost = charge.vendor_cost == null ? null : parseFloat(charge.vendor_cost);
  const msrp = charge.vendor_msrp == null ? null : parseFloat(charge.vendor_msrp);
  const margin = cost != null && unitPrice != null ? Math.round((unitPrice - cost) * 100) / 100 : null;
  return (
    <div className={`card p-4 ${charge.is_active ? '' : 'opacity-60'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h4 className="text-gray-200 font-medium">{charge.description}</h4>
            {charge.category && (
              <span className="text-xs text-gray-500 bg-surface-600 px-1.5 py-0.5 rounded-sm">{charge.category}</span>
            )}
            <OfficeBadge locations={locations} locationId={charge.location_id} companyName={companyName} />
            {charge.service_catalog_id && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-300" title={`Follows the "${charge.service_name ?? 'catalog'}" service price`}>
                <Link2 size={11} /> Catalog price
              </span>
            )}
            {charge.source === 'tdsynnex' && (
              <span className="badge bg-blue-900/40 text-blue-300 text-xs"
                title={`From TD SYNNEX${charge.external_status ? ` (${charge.external_status})` : ''}${charge.synced_at ? ` · last synced ${formatDate(charge.synced_at)}` : ''}`}>
                TD SYNNEX
              </span>
            )}
            {!charge.is_active && <span className="badge bg-surface-600 text-gray-400 text-xs">Inactive</span>}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
            <span className="text-gray-400">{cadenceLabel(charge.frequency, charge.interval_count)}</span>
            {due && (
              <span className="inline-flex items-center gap-1 text-blue-300">
                <CalendarClock size={12} /> Next: {nextDueLabel(due)}
              </span>
            )}
            {/* Annualized equivalent - shown for anything that doesn't already bill
                once a year, so a multi-year charge reads "$60/3yr · $20.00/yr". */}
            {timesPerYear !== 1 && parseFloat(charge.amount) > 0 && (
              <span className="text-gray-600">{money(parseFloat(charge.amount) * timesPerYear)}/yr</span>
            )}
          </div>
          {/* What we pay and the list price, beside what the customer is billed (TD SYNNEX imports). */}
          {(cost != null || msrp != null || charge.term_end_date) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-gray-500">
              {cost != null && <span>Cost {money(cost)}</span>}
              {msrp != null && <span>MSRP {money(msrp)}</span>}
              {margin != null && (
                <span className={margin < 0 ? 'text-red-400' : 'text-green-400'}>
                  Margin {money(margin)}{charge.unit_label ? ` per ${charge.unit_label.replace(/s$/, '')}` : ''}
                </span>
              )}
              {charge.term_end_date && <span>Term ends {formatDate(charge.term_end_date)}</span>}
            </div>
          )}
          {charge.notes && <p className="mt-2 text-xs text-gray-600 border-t border-surface-600 pt-2">{charge.notes}</p>}
        </div>

        <div className="flex flex-col items-end shrink-0 gap-1">
          <div className="text-right">
            <span className="text-accent font-semibold">{hasTotal ? money(charge.amount) : '—'}</span>
            <span className="text-gray-600 text-xs">/{cadenceUnit(charge.frequency, charge.interval_count)}</span>
            {showBreakdown && (
              <p className="text-gray-600 text-xs">
                {countLabel(qty, charge.unit_label)} × {money(unitPrice)}
              </p>
            )}
            {outOfSync && (
              <p className="text-amber-400 text-xs inline-flex items-center gap-1" title="This charge is linked to a catalog service whose price differs">
                <Link2Off size={11} /> Catalog: {money(catalogPrice)}
              </p>
            )}
          </div>
          <div className="flex gap-1">
            <button onClick={onEdit} className="btn-ghost p-1.5 text-gray-600 hover:text-gray-300"><Pencil size={13} /></button>
            <button onClick={onDelete} className="btn-ghost p-1.5 text-gray-600 hover:text-red-400"><Trash2 size={13} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Main tab -----------------------------------------------------------------

export function BillingTab({ customerId, locations = [], companyName }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [office, setOffice] = useOfficeFilter(customerId, 'billing', locations);
  const [sync, setSync] = useState(null);     // 'tdsynnex' | 'threatlocker'
  const integrations = useIntegrations();

  const { data: allCharges = [], refetch } = useQuery({
    queryKey: ['customers', customerId, 'recurring-charges'],
    queryFn: () => customersApi.recurringCharges.list(customerId).then(r => r.data),
  });

  const charges = allCharges.filter(c => officeMatches(c, office) && matchesQuery(c, search));

  const remove = async (id, name) => {
    if (!confirm(`Delete recurring charge "${name}"?`)) return;
    await customersApi.recurringCharges.remove(customerId, id);
    refetch();
  };

  // Totals are over ACTIVE charges only (inactive are history).
  const active = charges.filter(c => c.is_active);
  const monthly = active.filter(c => c.frequency === 'monthly');
  const periodic = active.filter(c => c.frequency !== 'monthly');
  const monthlySubtotal = monthly.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
  const periodicAnnualized = annualizedTotal(periodic);
  const annualizedAll = annualizedTotal(active);
  const monthlyEquivalent = annualizedAll / 12;

  const renderGroup = (title, list, subtitle) => (
    list.length > 0 && (
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{title}</h3>
          {subtitle && <span className="text-xs text-gray-500">{subtitle}</span>}
        </div>
        <div className="space-y-3">
          {list.map(c => (
            <ChargeCard key={c.id} charge={c} locations={locations} companyName={companyName}
              onEdit={() => setModal(c)} onDelete={() => remove(c.id, c.description)} />
          ))}
        </div>
      </div>
    )
  );

  // Show monthly-frequency charges together, then everything periodic; inactive ones fall
  // wherever their frequency puts them (dimmed).
  const monthlyGroup  = charges.filter(c => c.frequency === 'monthly');
  const periodicGroup = charges.filter(c => c.frequency !== 'monthly');

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchInput value={search} onChange={setSearch} placeholder="Search charges (name, category…)" className="w-full sm:w-72" />
          <OfficeFilterBar locations={locations} companyName={companyName} value={office} onChange={setOffice} />
        </div>
        <div className="flex flex-wrap items-center gap-2 ml-auto w-full sm:w-auto">
          {(integrations.tdsynnex || integrations.threatlocker) && (
          <MenuButton label="Import & sync" icon={CloudDownload} className="flex-1 sm:flex-none" items={[
            integrations.tdsynnex && { label: 'TD SYNNEX', icon: Cloud, hint: 'Microsoft 365 subscriptions — seats, cost, MSRP, term', onClick: () => setSync('tdsynnex') },
            integrations.threatlocker && { label: 'ThreatLocker', icon: ShieldCheck, hint: 'Computers per organization → seat count', onClick: () => setSync('threatlocker') },
          ].filter(Boolean)} />
          )}
          <button onClick={() => setModal('new')} className="btn-primary flex items-center justify-center gap-2 text-sm flex-1 sm:flex-none whitespace-nowrap">
            <Plus size={14} /> Add Charge
          </button>
        </div>
      </div>

      {/* Recurring-revenue summary */}
      {active.length > 0 && (
        <div className="card p-4 mb-5 flex flex-wrap items-center gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Monthly recurring</p>
            <p className="text-xl font-bold text-gray-100">{money(monthlyEquivalent)}<span className="text-sm text-gray-500 font-normal">/mo</span></p>
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider">Annualized</p>
            <p className="text-xl font-bold text-accent">{money(annualizedAll)}<span className="text-sm text-gray-500 font-normal">/yr</span></p>
          </div>
          <p className="text-xs text-gray-600 ml-auto max-w-xs">
            Monthly figure blends every cadence into a per-month equivalent. Inactive charges are excluded.
          </p>
        </div>
      )}

      {allCharges.length === 0 ? (
        <EmptyState icon={Receipt} title="No recurring charges"
          description="Track what this customer is billed on a recurring basis — monthly antivirus/backups, annual M365, etc." />
      ) : charges.length === 0 ? (
        <p className="text-gray-600 text-sm text-center py-8">No charges match.</p>
      ) : (
        <div className="space-y-6">
          {renderGroup('Monthly', monthlyGroup, monthlySubtotal > 0 ? `${money(monthlySubtotal)}/mo` : null)}
          {renderGroup('Annual & Periodic', periodicGroup, periodicAnnualized > 0 ? `${money(periodicAnnualized)}/yr` : null)}
        </div>
      )}

      <Modal open={modal !== null} onClose={() => setModal(null)}
        title={modal === 'new' ? 'Add Recurring Charge' : 'Edit Recurring Charge'} size="lg">
        {modal !== null && (
          <ChargeForm
            customerId={customerId}
            charge={modal === 'new' ? null : modal}
            locations={locations}
            companyName={companyName}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setModal(null)}
            onSaved={() => { setModal(null); refetch(); }}
          />
        )}
      </Modal>

      <Modal open={sync === 'tdsynnex'} onClose={() => setSync(null)} title="Import from TD SYNNEX" size="lg">
        {sync === 'tdsynnex' && (
          <TdSynnexImport
            customerId={customerId}
            companyName={companyName}
            locations={locations}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setSync(null)}
            onImported={() => refetch()}
          />
        )}
      </Modal>

      <Modal open={sync === 'threatlocker'} onClose={() => setSync(null)}
        title="Sync seats from ThreatLocker" size="lg">
        {sync === 'threatlocker' && (
          <SeatSync
            key={sync}
            provider={sync}
            customerId={customerId}
            companyName={companyName}
            locations={locations}
            defaultLocationId={defaultOfficeFor(office)}
            onClose={() => setSync(null)}
            onImported={() => refetch()}
          />
        )}
      </Modal>
    </div>
  );
}
