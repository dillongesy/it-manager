import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { BrandingProvider } from './contexts/BrandingContext.jsx';
import App from './App';
import './index.css';

// Scrolling over a focused number input silently changes its value in most
// browsers — dangerous for hand-typed hours/quantities. Blur the field on wheel
// so the page scrolls normally and the value is left untouched. Passive listener
// keeps scrolling smooth; blurring (not preventDefault) avoids trapping scroll.
window.addEventListener('wheel', (e) => {
  const el = document.activeElement;
  if (el && el.type === 'number' && el === e.target) el.blur();
}, { passive: true });

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <BrandingProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrandingProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
