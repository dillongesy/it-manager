import { useState, useEffect } from 'react';
import { Eye, EyeOff, Copy, Check, Loader } from 'lucide-react';
import { copyText } from '../../utils/clipboard.js';

const HIDE_AFTER_MS = 30_000;

export function CredentialField({ onReveal, hasValue }) {
  const [value, setValue]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied]   = useState(false);
  const [timer, setTimer]     = useState(null);

  useEffect(() => () => clearTimeout(timer), [timer]);

  const reveal = async () => {
    if (value) { setValue(null); clearTimeout(timer); return; }
    if (!onReveal) return;
    setLoading(true);
    try {
      const result = await onReveal();
      setValue(result);
      const t = setTimeout(() => setValue(null), HIDE_AFTER_MS);
      setTimer(t);
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    const val = value ?? (onReveal ? await onReveal() : null);
    if (!val) return;
    if (await copyText(val)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!hasValue) {
    return <span className="text-gray-600 text-sm italic">not set</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="font-mono text-sm text-gray-300 min-w-[120px]">
        {value ?? '••••••••••••'}
      </span>
      <button
        onClick={reveal}
        className="text-gray-500 hover:text-accent transition-colors p-1 rounded-sm"
        title={value ? 'Hide' : 'Reveal (logged)'}
      >
        {loading ? <Loader size={13} className="animate-spin" /> : value ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
      <button
        onClick={copy}
        className="text-gray-500 hover:text-accent transition-colors p-1 rounded-sm"
        title="Copy to clipboard"
      >
        {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
      </button>
    </div>
  );
}
