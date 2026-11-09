import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { Camera, Upload, X } from 'lucide-react';
import { photosApi } from '../api/workOrders.js';
import AuthImage from '../components/AuthImage.jsx';

export default function Photos() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const workOrderId = params.get('workOrderId') || '';
  const customerName = params.get('customerName') || '';
  const customerAddress = params.get('customerAddress') || '';
  const scoped = Boolean(workOrderId || customerName);

  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [viewer, setViewer] = useState(null);
  const fileRef = useRef(null);
  const cameraRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = {};
      if (workOrderId) q.workOrderId = workOrderId;
      if (customerName) q.customerName = customerName;
      else if (search) q.customerName = search;
      const res = await photosApi.list(q);
      setPhotos(res.data || []);
    } finally {
      setLoading(false);
    }
  }, [workOrderId, customerName, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('photos', f);
      if (workOrderId) fd.append('work_order_id', workOrderId);
      if (customerName) fd.append('customer_name', customerName);
      if (customerAddress) fd.append('customer_address', customerAddress);
      await photosApi.upload(fd);
      await load();
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (photoId) => {
    if (!window.confirm('Delete this photo?')) return;
    await photosApi.remove(photoId);
    setViewer(null);
    await load();
  };

  const groups = photos.reduce((acc, p) => {
    const key = [p.customer_name || 'Unassigned', p.customer_address || ''].filter(Boolean).join(' — ');
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  return (
    <div className="p-4 space-y-4">
      {scoped && <button onClick={() => navigate(-1)} className="text-gray-500 text-sm">← Back</button>}
      <h1 className="text-2xl font-bold">Photos</h1>
      {scoped && (
        <p className="text-gray-500 text-sm -mt-2">{customerName}{customerAddress ? ` · ${customerAddress}` : ''}</p>
      )}

      {!scoped && (
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by customer…"
          className="input"
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => cameraRef.current?.click()} disabled={uploading} className="btn-primary flex items-center justify-center gap-2"><Camera size={18} />Take photo</button>
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-secondary flex items-center justify-center gap-2"><Upload size={18} />Upload</button>
      </div>
      {uploading && <p className="text-gray-500 text-sm text-center">Uploading…</p>}

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple onChange={handleFiles} className="hidden" />
      <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} className="hidden" />

      {loading ? (
        <p className="text-gray-500 text-center py-8">Loading…</p>
      ) : photos.length === 0 ? (
        <p className="text-gray-500 text-center py-8">No photos yet.</p>
      ) : (
        Object.entries(groups).map(([group, ps]) => (
          <div key={group}>
            {!scoped && <h2 className="text-sm uppercase text-gray-500 mb-2">{group}</h2>}
            <div className="grid grid-cols-3 gap-2">
              {ps.map((p) => (
                <button key={p.id} onClick={() => setViewer(p)} className="aspect-square rounded-xl overflow-hidden bg-surface-700">
                  <AuthImage photoId={p.id} alt={p.original_name || ''} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        ))
      )}

      {viewer && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setViewer(null)}>
          <div className="flex justify-end p-4 safe-top">
            <button className="text-white w-10 h-10 flex items-center justify-center" aria-label="Close"><X size={28} /></button>
          </div>
          <div className="flex-1 flex items-center justify-center px-4" onClick={(e) => e.stopPropagation()}>
            <AuthImage photoId={viewer.id} alt={viewer.original_name || ''} className="max-w-full max-h-full object-contain rounded-xl" />
          </div>
          <div className="p-4 safe-bottom text-center" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => handleDelete(viewer.id)} className="text-brand font-semibold">Delete photo</button>
          </div>
        </div>
      )}
    </div>
  );
}
