import { useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';

// Read an image File and return a (possibly downscaled) JPEG/PNG data URL so the
// image embeds inline in the HTML — no upload endpoint, no orphaned files, and it
// renders without needing the in-memory JWT that <img src="/api/…"> can't send.
export function fileToDataUrl(file, maxDim = 1600) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale === 1) { resolve(reader.result); return; }  // small enough already
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const isPng = /png$/i.test(file.type);
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Shared Tiptap rich-text editor (bold/italic/headings/lists/code + inline images).
// Images are embedded as base64 data URLs. `content` is read only at init, so mount
// this only once the initial HTML is ready (gate the parent on any async fetch).
export function RichTextEditor({ content, onChange, placeholder = 'Write here…', minHeight = 220 }) {
  const fileRef = useRef(null);
  const busyRef = useRef(false);
  const editor = useEditor({
    extensions: [
      // Tiptap v3 folds Link (and Underline) into StarterKit, so configure Link
      // through it rather than registering a second, duplicate Link extension.
      StarterKit.configure({ link: { openOnClick: false } }),
      Image.configure({ inline: false }),
      Placeholder.configure({ placeholder }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const openImagePicker = () => { if (busyRef.current) return; fileRef.current?.click(); };

  const onPickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';  // reset so picking the same file again still fires onChange
    if (!file || !editor) return;
    busyRef.current = true;
    try {
      const src = await fileToDataUrl(file);
      editor.chain().focus().setImage({ src }).run();
    } catch {
      alert('Could not load that image.');
    } finally {
      busyRef.current = false;
    }
  };

  if (!editor) return null;

  const btn = (action, label, active = false) => (
    <button type="button" onClick={action}
      className={`px-2 py-1 text-xs rounded transition-colors ${
        active ? 'bg-brand/20 text-accent' : 'text-gray-400 hover:bg-surface-500 hover:text-gray-200'
      }`}>
      {label}
    </button>
  );

  return (
    <div className="border border-surface-500 rounded-lg overflow-hidden">
      <div className="flex flex-wrap gap-0.5 p-1.5 bg-surface-700 border-b border-surface-600">
        {btn(() => editor.chain().focus().toggleBold().run(), 'B', editor.isActive('bold'))}
        {btn(() => editor.chain().focus().toggleItalic().run(), 'I', editor.isActive('italic'))}
        {btn(() => editor.chain().focus().toggleCode().run(), '<>', editor.isActive('code'))}
        <div className="w-px bg-surface-500 mx-1" />
        {btn(() => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2', editor.isActive('heading', { level: 2 }))}
        {btn(() => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3', editor.isActive('heading', { level: 3 }))}
        <div className="w-px bg-surface-500 mx-1" />
        {btn(() => editor.chain().focus().toggleBulletList().run(), '• List', editor.isActive('bulletList'))}
        {btn(() => editor.chain().focus().toggleOrderedList().run(), '1. List', editor.isActive('orderedList'))}
        {btn(() => editor.chain().focus().toggleCodeBlock().run(), 'Code', editor.isActive('codeBlock'))}
        <div className="w-px bg-surface-500 mx-1" />
        {btn(openImagePicker, 'Image')}
      </div>
      {/* Click anywhere in the box (incl. padding / blank area) to place the cursor —
          padding + min-height live on the editable element so the whole box is clickable. */}
      <EditorContent
        editor={editor}
        style={{ '--rt-min': `${minHeight}px` }}
        className="prose prose-sm max-w-none cursor-text
                   [&_.tiptap]:outline-hidden [&_.tiptap]:p-4 [&_.tiptap]:min-h-(--rt-min)
                   [&_.tiptap_p]:text-gray-300 [&_.tiptap_h2]:text-gray-200
                   [&_.tiptap_h3]:text-gray-300 [&_.tiptap_code]:text-accent
                   [&_.tiptap_pre]:bg-surface-900 [&_.tiptap_pre]:rounded-sm [&_.tiptap_pre]:p-3
                   [&_.tiptap_.is-editor-empty:first-child::before]:text-gray-600
                   [&_.tiptap_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]
                   [&_.tiptap_.is-editor-empty:first-child::before]:float-left
                   [&_.tiptap_.is-editor-empty:first-child::before]:pointer-events-none"
      />
      {/* sr-only (not display:none) so programmatic .click() is reliable cross-browser */}
      <input ref={fileRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} onChange={onPickImage} />
    </div>
  );
}

// Read-only renderer for stored rich-text HTML.
export function RichTextView({ html, className = '' }) {
  if (!html || !html.replace(/<[^>]*>/g, '').trim() && !/<img/i.test(html)) {
    return <p className="text-gray-600 text-sm italic">No details.</p>;
  }
  return (
    <div
      className={`prose prose-sm max-w-none ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
