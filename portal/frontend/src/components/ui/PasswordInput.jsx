import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Secret-value entry with a show/hide toggle so the typist can verify what they
 * typed (these forms store OTHER systems' credentials on a LAN-only admin tool, so
 * brief on-screen visibility is fine and silent typos are the real risk).
 *
 * Crucially this is NOT an <input type="password">. Chrome/Edge fire the
 * "save password?" prompt and autofill on ANY password field regardless of
 * autocomplete hints. We use a normal text input and mask it with CSS
 * (-webkit-text-security) when hidden, so the browser never sees a password field.
 */
export function PasswordInput({ value, onChange, placeholder, className = '' }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`input font-mono pr-9 ${className}`}
        style={show ? undefined : { WebkitTextSecurity: 'disc', textSecurity: 'disc' }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-accent transition-colors p-1"
        title={show ? 'Hide' : 'Show'}
        aria-label={show ? 'Hide value' : 'Show value'}
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
