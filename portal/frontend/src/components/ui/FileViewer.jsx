import { useEffect, useState } from 'react';
import { X, Download } from 'lucide-react';
import { customersApi } from '../../api/customers.js';

// Full-screen viewer for images and PDFs. The file endpoint needs a Bearer token,
// so a plain <img>/<iframe src> would 401 — we fetch the bytes as a blob and use an
// object URL. Anything that isn't an image/PDF just offers a download.
//
// Props:
//   customerId  – required when fetchFn/downloadFn are NOT provided (customer files)
//   fetchFn     – optional (file) => Promise<{data:Blob}>  — overrides customersApi view
//   downloadFn  – optional (file) => Promise<{data:Blob}>  — overrides customersApi download
export function FileViewer({ customerId, file, onClose, fetchFn, downloadFn }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  const mime = file?.mime_type ?? '';
  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';
  const viewable = isImage || isPdf;

  useEffect(() => {
    // Reset stale state whenever the viewed file changes.
    setUrl(null);
    setFailed(false);
    if (!file || !viewable) return;

    let objUrl;
    let cancelled = false;
    const request = fetchFn ? fetchFn(file) : customersApi.files.view(customerId, file.id);
    request
      .then(({ data }) => {
        if (cancelled) return;
        // Guarantee the blob URL carries the correct MIME type.
        // If the server response blob type differs (e.g. application/octet-stream),
        // the browser treats the iframe content as a download instead of rendering it.
        const typed = mime && data.type !== mime ? new Blob([data], { type: mime }) : data;
        objUrl = URL.createObjectURL(typed);
        setUrl(objUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    const { data } = downloadFn
      ? await downloadFn(file)
      : await customersApi.files.download(customerId, file.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data);
    a.download = file.original_name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-surface-800 border-b border-surface-600">
        <span className="text-gray-200 text-sm truncate">{file.original_name}</span>
        <div className="flex items-center gap-2">
          <button onClick={download} className="btn-ghost p-1.5 text-gray-400 hover:text-accent" title="Download">
            <Download size={16} />
          </button>
          <button onClick={onClose} className="btn-ghost p-1.5 text-gray-400 hover:text-gray-100" title="Close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {!viewable ? (
          <div className="text-center text-gray-400">
            <p className="mb-3">This file type can't be previewed.</p>
            <button onClick={download} className="btn-primary">Download instead</button>
          </div>
        ) : failed ? (
          <p className="text-red-400">Couldn't load the file.</p>
        ) : !url ? (
          <div className="w-6 h-6 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        ) : isImage ? (
          <img src={url} alt={file.original_name} className="max-w-full max-h-full object-contain" />
        ) : (
          <iframe src={url} title={file.original_name} className="w-full h-full bg-white rounded-sm" />
        )}
      </div>
    </div>
  );
}
