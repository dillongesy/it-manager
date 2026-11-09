import { useRef } from 'react';
import { SuggestInput } from './SuggestInput.jsx';
import { serviceCatalogApi } from '../../api/serviceCatalog.js';
import { noAutofill } from './noAutofill.js';

// Category / unit-label inputs that suggest what has ALREADY been entered — pooled
// across the Services catalog and every customer's recurring charges. Typing
// "Microsoft 365" once anywhere makes it a one-click pick everywhere after that, so
// the same category doesn't end up spelled three ways.
//
// Suggestions open on focus (minChars 0) with an empty box, so you can see the
// existing list without guessing the first letter. Free-typing a brand-new value
// always works — the list is a shortcut, never a constraint.

function CatalogSuggest({ field, value, onChange, placeholder }) {
  // Randomized name: Chrome keys its remembered-value autofill by field name, and
  // would otherwise overlay its own dropdown on top of ours.
  const nameRef = useRef(`app-${field}-${Math.random().toString(36).slice(2)}`);
  return (
    <SuggestInput
      value={value ?? ''}
      onChange={onChange}
      minChars={0}
      fetch={(q) => serviceCatalogApi.suggestions(field, q)}
      placeholder={placeholder}
      inputProps={{ ...noAutofill, name: nameRef.current, role: 'presentation' }}
    />
  );
}

export function CategoryInput({ value, onChange, placeholder = 'Antivirus, Backup, Microsoft 365…' }) {
  return <CatalogSuggest field="category" value={value} onChange={onChange} placeholder={placeholder} />;
}

export function UnitLabelInput({ value, onChange, placeholder = 'seats, TB, licenses…' }) {
  return <CatalogSuggest field="unit_label" value={value} onChange={onChange} placeholder={placeholder} />;
}
