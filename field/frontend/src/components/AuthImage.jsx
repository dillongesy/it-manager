import { useEffect, useState } from 'react';
import api from '../api/client.js';

/**
 * Photos are served from an authenticated endpoint (Bearer token), so a plain
 * <img src> would 401. Fetch the bytes via the axios client (which attaches the
 * token) and render an object URL instead.
 */
export default function AuthImage({ photoId, alt = '', className }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let url;
    let cancelled = false;
    api
      .get(`/photos/${photoId}/view`, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        url = URL.createObjectURL(res.data);
        setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photoId]);

  if (!src) return <div className={`bg-surface-700 animate-pulse ${className || ''}`} />;
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}
