import { createContext, useContext, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api/client.js';
import { applyBrandTheme, applyDocumentBranding } from '../lib/brandTheme.js';

// Everything white-label: names, colors, contact details for the print header, and
// uploaded images. Loaded once (public endpoint — works before sign-in) and
// re-fetched whenever Admin → Branding saves.

export const BRANDING_DEFAULTS = {
  companyName: 'Your Company',
  productName: 'IT Manager',
  fieldAppName: 'Field',
  tagline: '',
  primaryColor: '#2563EB',
  accentColor: '#F59E0B',
  address: '', phone: '', email: '', website: '', printFooter: '',
  assets: {},
};

const BrandingContext = createContext(BRANDING_DEFAULTS);

// Kept outside React too, for plain-JS helpers such as the print windows.
let current = BRANDING_DEFAULTS;
export const getBranding = () => current;

export function BrandingProvider({ children }) {
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api.get('/branding').then(r => r.data),
    staleTime: 5 * 60_000,
    retry: 2,
  });
  const branding = { ...BRANDING_DEFAULTS, ...(data ?? {}), assets: data?.assets ?? {} };
  current = branding;

  useEffect(() => {
    applyBrandTheme(branding);
    applyDocumentBranding({
      title: branding.productName,
      appleTitle: branding.productName,
      faviconUrl: branding.assets.favicon,
    });
  }, [branding.primaryColor, branding.accentColor, branding.productName, branding.assets.favicon]); // eslint-disable-line react-hooks/exhaustive-deps

  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export const useBranding = () => useContext(BrandingContext);

export function useRefreshBranding() {
  const qc = useQueryClient();
  return (data) => (data ? qc.setQueryData(['branding'], data) : qc.invalidateQueries({ queryKey: ['branding'] }));
}
