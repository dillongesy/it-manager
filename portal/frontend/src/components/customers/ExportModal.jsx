import { useState } from 'react';
import { FileDown, FileSpreadsheet, ShieldAlert, Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import { noAutofill } from '../ui/noAutofill.js';
import { customersApi } from '../../api/customers.js';
import { tasksApi } from '../../api/tasks.js';
import { workOrdersApi } from '../../api/workOrders.js';
import { loadProposalImages, missingProposalsMessage } from '../../lib/proposalImages.js';
import { printCustomerExport } from '../../lib/printCustomerExport.js';
import { RANGE_PRESETS, rangeLabel } from '../../utils/dateRanges.js';
import { fetchAllPages } from '../../hooks/useInfiniteList.js';
import { useAuth } from '../../contexts/AuthContext.jsx';

// ─── Customer (PDF) mode ────────────────────────────────────────────────────────

function CustomerMode({ customer }) {
  const [presetId, setPresetId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo]     = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Selecting a quick preset fills the date inputs; editing a date switches to custom.
  const applyPreset = (p) => {
    const { from: f, to: t } = p.compute();
    setPresetId(p.id);
    setFrom(f ?? '');
    setTo(t ?? '');
  };

  const generate = async () => {
    setError('');
    setBusy('Loading customer data…');
    try {
      const dateFrom = from || undefined;
      const dateTo   = to   || undefined;

      const [workOrders, todoRes, propRes, licRes, chargeRes] = await Promise.all([
        // Page through every matching work order — an export that stopped at the
        // API's page size would silently leave work off the customer's report.
        fetchAllPages(({ limit, offset }) =>
          workOrdersApi.list({ customerId: customer.id, dateFrom, dateTo, limit, offset })),
        tasksApi.list({ customerId: customer.id, status: 'all', sort: 'priority' }),
        customersApi.files.list(customer.id, 'proposal'),
        customersApi.licenses.list(customer.id),
        customersApi.recurringCharges.list(customer.id),
      ]);

      // Fetch each WO's full detail + pre-render any linked proposal PDFs to images,
      // mirroring the single-WO print flow so appended pages look identical.
      const fullWorkOrders = [];
      // Proposals that can't be rendered are collected per work order rather than
      // skipped silently — an export that quietly drops an attachment looks complete.
      const proposalFailures = [];
      for (let i = 0; i < workOrders.length; i++) {
        setBusy(`Preparing work orders… (${i + 1}/${workOrders.length})`);
        const { data: wo } = await workOrdersApi.get(workOrders[i].id);
        const { images, failures } = await loadProposalImages(wo);
        for (const fail of failures) {
          proposalFailures.push({ ...fail, name: `WO-${String(wo.number).padStart(5, '0')}: ${fail.name}` });
        }
        fullWorkOrders.push({ wo, proposalImages: images });
      }
      if (proposalFailures.length && !confirm(`${missingProposalsMessage(proposalFailures)}\n\nContinue?`)) {
        setBusy('');
        return;
      }

      setBusy('Opening print view…');
      printCustomerExport({
        customer,
        workOrders,
        fullWorkOrders,
        todos: todoRes.data,   // the customer's tasks
        proposals: propRes.data,
        licenses: licRes.data,
        recurringCharges: chargeRes.data,
        rangeLabel: rangeLabel({ id: presetId, from, to }),
      });
    } catch (err) {
      setError(err.response?.data?.error ?? 'Could not build the export.');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-400">
        Builds a printable PDF: overview, a work-order summary, to-dos, proposals, licensing and
        recurring billing — with every work order in the selected range appended in full at the end.
        Use your browser's <span className="text-gray-300">Save as PDF</span> in the print dialog.
      </p>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">Work-order date range</label>
        <div className="flex flex-wrap gap-2 mb-3">
          {RANGE_PRESETS.map(p => (
            <button key={p.id} type="button" onClick={() => applyPreset(p)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                presetId === p.id
                  ? 'border-brand bg-brand/15 text-gray-100'
                  : 'border-surface-500 text-gray-400 hover:text-gray-200 hover:border-surface-400'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">From</label>
            <input type="date" className="input text-sm" value={from}
              onChange={e => { setFrom(e.target.value); setPresetId('custom'); }} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">To</label>
            <input type="date" className="input text-sm" value={to}
              onChange={e => { setTo(e.target.value); setPresetId('custom'); }} />
          </div>
        </div>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex justify-end pt-1">
        <button onClick={generate} disabled={!!busy}
          className="btn-primary flex items-center gap-2 text-sm">
          {busy ? <><Loader2 size={14} className="animate-spin" /> {busy}</> : <><FileDown size={14} /> Generate PDF</>}
        </button>
      </div>
    </div>
  );
}

// ─── Provider (Excel) mode ──────────────────────────────────────────────────────

function ProviderMode({ customer }) {
  const { user } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-900/20 border border-amber-800/40">
        <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-sm text-amber-200">
          The provider handoff export includes all stored passwords and is restricted to administrators.
          Ask an admin to run it.
        </p>
      </div>
    );
  }

  const exportNow = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await customersApi.export.provider(customer.id, password);
      const url = URL.createObjectURL(res.data);
      const stamp = new Date().toISOString().slice(0, 10);
      const safe = (customer.name || 'customer').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safe}-provider-export-${stamp}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setPassword('');
    } catch (err) {
      // The error body is a Blob (responseType: 'blob') — read it back as JSON.
      let msg = 'Export failed.';
      try {
        const text = await err.response?.data?.text?.();
        if (text) msg = JSON.parse(text).error ?? msg;
      } catch { /* keep default */ }
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-brand/10 border border-brand/30">
        <ShieldAlert size={18} className="text-brand shrink-0 mt-0.5" />
        <p className="text-sm text-gray-300">
          Exports an Excel workbook with <span className="text-gray-100 font-medium">all decrypted passwords</span> —
          overview, devices, credentials, cameras, current to-dos, licensing, and billing. Intended for handing a
          customer off to another IT provider. This action is recorded in the audit log.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Confirm your password to continue</label>
        <input type="password" className="input" {...noAutofill} value={password}
          onChange={e => setPassword(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && password && !busy) exportNow(); }}
          placeholder="Your account password" autoFocus />
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="flex justify-end pt-1">
        <button onClick={exportNow} disabled={busy || !password}
          className="btn-primary flex items-center gap-2 text-sm">
          {busy ? <><Loader2 size={14} className="animate-spin" /> Exporting…</> : <><FileSpreadsheet size={14} /> Export Excel</>}
        </button>
      </div>
    </div>
  );
}

// ─── Modal shell ────────────────────────────────────────────────────────────────

export function ExportModal({ customer, open, onClose }) {
  const [mode, setMode] = useState('customer');

  return (
    <Modal open={open} onClose={onClose} title="Export Customer" size="lg">
      <div className="space-y-5">
        <div className="flex gap-2 p-1 bg-surface-700 rounded-lg">
          {[
            ['customer', 'To Customer (PDF)', FileDown],
            ['provider', 'To Provider (Excel)', FileSpreadsheet],
          ].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`flex-1 flex items-center justify-center gap-2 text-sm py-2 rounded-md transition-colors ${
                mode === id ? 'bg-surface-500 text-gray-100' : 'text-gray-400 hover:text-gray-200'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {mode === 'customer' ? <CustomerMode customer={customer} /> : <ProviderMode customer={customer} />}
      </div>
    </Modal>
  );
}
