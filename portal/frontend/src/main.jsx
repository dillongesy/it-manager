import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.jsx';
import { ThemeProvider } from './contexts/ThemeContext.jsx';
import { BrandingProvider } from './contexts/BrandingContext.jsx';
import './index.css';

// Scrolling over a focused number input silently changes its value in most
// browsers — dangerous for hand-typed quantities/prices/hours. Blur the field on
// wheel so the page scrolls normally and the value is left untouched. Passive
// listener keeps scrolling smooth; blurring (not preventDefault) avoids trapping scroll.
window.addEventListener('wheel', (e) => {
  const el = document.activeElement;
  if (el && el.type === 'number' && el === e.target) el.blur();
}, { passive: true });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrandingProvider>
            <App />
          </BrandingProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
