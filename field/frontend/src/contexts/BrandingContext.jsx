import { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client';
import { applyBrandTheme, applyDocumentBranding } from '../lib/brandTheme.js';

// Branding is edited in the Portal (Admin → Branding) and pushed to this app over
// the one-way bridge. This just reads the local copy (public endpoint).
const DEFAULTS = {
  companyName: 'Your Company', productName: 'IT Manager', fieldAppName: 'Field',
  primaryColor: '#2563EB', accentColor: '#F59E0B', assets: {},
};

const BrandingContext = createContext(DEFAULTS);

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULTS);

  useEffect(() => {
    api.get('/branding').then(r => setBranding({ ...DEFAULTS, ...r.data, assets: r.data?.assets ?? {} })).catch(() => {});
  }, []);

  useEffect(() => {
    applyBrandTheme(branding);
    const title = `${branding.companyName} ${branding.fieldAppName}`.trim();
    applyDocumentBranding({ title, appleTitle: branding.fieldAppName, faviconUrl: branding.assets.favicon });
  }, [branding]);

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);
