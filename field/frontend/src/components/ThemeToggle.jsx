import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext.jsx';

// Icon button that flips light/dark. Shows the icon for the theme you'd switch TO.
export function ThemeToggle({ size = 20, className = '' }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      className={`p-2 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-surface-600 transition-colors active:scale-95 ${className}`}
    >
      {dark ? <Sun size={size} /> : <Moon size={size} />}
    </button>
  );
}
