import { useState, useEffect } from 'react';
import { isAnnual, coerceIntervalCount, cadenceLabel, MAX_INTERVAL_COUNT } from '../../utils/cadence.js';

// One control for "how often does this bill", shared by the Services catalog, a
// customer's Billing tab and the Licensing tab so all three read and behave alike.
//
// The base cadence is a plain dropdown. Choosing a YEARLY one reveals an "every N
// year(s)" box beside it - because "Annually" is just "every 1 year", making the
// multi-year case a number rather than a separate mode or a fixed list of
// biennial/triennial options. Anything but a yearly cadence forces the count back to
// 1: "every 2 quarters" reads worse than "Semi-annual" and buys nothing.
//
// `options` differ per caller only because the schema stores two spellings of the
// yearly period ('annual' in the service catalog, 'annually' on recurring charges).
export function CadenceSelect({ options, frequency, count, onChange, disabled = false, inputClass = 'input' }) {
  const n = coerceIntervalCount(count, frequency);
  // The box is free to be empty mid-typing; the committed value never is.
  const [text, setText] = useState(String(n));
  useEffect(() => { setText(String(n)); }, [n]);

  const annual = isAnnual(frequency);

  const setFrequency = (value) =>
    onChange({ frequency: value, count: isAnnual(value) ? n : 1 });

  const setCount = (raw) => {
    setText(raw);
    if (raw === '') return;                     // let them clear it and retype
    onChange({ frequency, count: coerceIntervalCount(raw, frequency) });
  };

  return (
    <div className="flex items-stretch gap-2">
      <select className={`${inputClass} flex-1`} value={frequency} disabled={disabled}
        onChange={(e) => setFrequency(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {annual && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs text-gray-500">every</span>
          <input className={`${inputClass} w-16 text-center`} type="number" min="1" max={MAX_INTERVAL_COUNT}
            step="1" inputMode="numeric" value={text} disabled={disabled}
            onChange={(e) => setCount(e.target.value)}
            onBlur={() => setText(String(n))}
            onWheel={(e) => e.currentTarget.blur()} />
          <span className="text-xs text-gray-500 w-9">{n === 1 ? 'year' : 'years'}</span>
        </div>
      )}
    </div>
  );
}

// "Bills once every 3 years." - the plain-language echo under the control, so a
// mistyped count is obvious before saving.
export function CadenceHint({ frequency, count, prefix = 'Bills', suffix = '.' }) {
  const n = coerceIntervalCount(count, frequency);
  const phrase = n > 1
    ? `once every ${n} years`
    : `${cadenceLabel(frequency, 1).toLowerCase()}`;
  return <span>{prefix} {phrase}{suffix}</span>;
}
