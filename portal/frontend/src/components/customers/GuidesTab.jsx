import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ArrowLeft, BookOpen } from 'lucide-react';
import { customersApi } from '../../api/customers.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import { RichTextEditor } from '../ui/RichText.jsx';

function GuideEditor({ customerId, guide, onBack }) {
  // The list endpoint omits `content`, and Tiptap only reads content at init — so
  // when editing an existing guide we must fetch the full record first, otherwise
  // the editor starts blank and a save would wipe the guide.
  const editingId = guide?.id ?? null;
  const { data: full, isLoading } = useQuery({
    queryKey: ['customers', customerId, 'guides', editingId, 'full'],
    queryFn: () => customersApi.guides.get(customerId, editingId).then(r => r.data),
    enabled: !!editingId,
  });

  const qc = useQueryClient();
  const [title, setTitle]   = useState(guide?.title ?? '');
  const [content, setContent] = useState('');
  const [ready, setReady]   = useState(!editingId);  // new guide: ready immediately
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (full) {
      setTitle(full.title ?? '');
      setContent(full.content ?? '');
      setReady(true);
    }
  }, [full]);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await customersApi.guides.update(customerId, editingId, { title, content });
      } else {
        await customersApi.guides.create(customerId, { title, content });
      }
      // Invalidate every cached guide query for this customer (list, viewer, and the
      // editor's "full" fetch all share this prefix) so reopening shows the new content
      // without needing a page refresh.
      qc.invalidateQueries({ queryKey: ['customers', customerId, 'guides'] });
      onBack(true);
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => onBack(false)} className="btn-ghost flex items-center gap-1.5 text-sm py-1.5">
          <ArrowLeft size={14} /> Back
        </button>
        <div className="flex-1">
          <input
            className="input text-lg font-semibold bg-transparent border-none px-0 focus:ring-0 focus:outline-hidden"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Guide title…"
          />
        </div>
        <button onClick={save} disabled={saving || !title.trim() || !ready} className="btn-primary">
          {saving ? 'Saving…' : 'Save Guide'}
        </button>
      </div>
      {/* Mount the editor only once content is loaded so Tiptap initializes with it. */}
      {ready
        ? <RichTextEditor content={content} onChange={setContent} placeholder="Write your how-to guide here…" minHeight={320} />
        : <div className="text-gray-600 text-sm p-4">{isLoading ? 'Loading…' : ''}</div>}
    </div>
  );
}

function GuideViewer({ customerId, guideId, onEdit, onBack }) {
  const { data: guide } = useQuery({
    queryKey: ['customers', customerId, 'guides', guideId],
    queryFn: () => customersApi.guides.get(customerId, guideId).then(r => r.data),
  });

  if (!guide) return <div className="text-gray-600 text-sm p-4">Loading…</div>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="btn-ghost flex items-center gap-1.5 text-sm py-1.5">
          <ArrowLeft size={14} /> Back
        </button>
        <h2 className="text-gray-200 font-semibold text-lg flex-1">{guide.title}</h2>
        <button onClick={onEdit} className="btn-secondary flex items-center gap-1.5 text-sm"><Pencil size={13} /> Edit</button>
      </div>
      <div
        className="prose prose-sm max-w-none p-4 card"
        dangerouslySetInnerHTML={{ __html: guide.content }}
      />
    </div>
  );
}

export function GuidesTab({ customerId }) {
  const [view, setView] = useState('list');
  const [selected, setSelected] = useState(null);

  const { data: guides = [], refetch } = useQuery({
    queryKey: ['customers', customerId, 'guides'],
    queryFn: () => customersApi.guides.list(customerId).then(r => r.data),
  });

  const remove = async (id, title) => {
    if (!confirm(`Delete guide "${title}"?`)) return;
    await customersApi.guides.remove(customerId, id);
    refetch();
  };

  if (view === 'edit') {
    return <GuideEditor customerId={customerId} guide={selected}
      onBack={(saved) => { setView('list'); if (saved) refetch(); }} />;
  }

  if (view === 'view') {
    return <GuideViewer customerId={customerId} guideId={selected?.id}
      onEdit={() => setView('edit')}
      onBack={() => setView('list')} />;
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => { setSelected(null); setView('edit'); }} className="btn-primary flex items-center gap-2 text-sm">
          <Plus size={14} /> New Guide
        </button>
      </div>

      {guides.length === 0 ? (
        <EmptyState icon={BookOpen} title="No guides yet"
          description="Create how-to guides with rich text and embedded images." />
      ) : (
        <div className="space-y-2">
          {guides.map(g => (
            <div key={g.id} className="card p-4 flex items-center justify-between hover:bg-surface-700/50 transition-colors">
              <button onClick={() => { setSelected(g); setView('view'); }} className="text-left flex-1">
                <p className="text-gray-200 font-medium">{g.title}</p>
                <p className="text-gray-600 text-xs mt-0.5">
                  Updated {new Date(g.updated_at).toLocaleDateString()}
                </p>
              </button>
              <div className="flex gap-1 ml-3">
                <button onClick={() => { setSelected(g); setView('edit'); }} className="btn-ghost p-1.5"><Pencil size={13} /></button>
                <button onClick={() => remove(g.id, g.title)} className="btn-ghost p-1.5 hover:text-red-400"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
