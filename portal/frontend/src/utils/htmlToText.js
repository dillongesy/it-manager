// Convert stored rich-text HTML to readable plain text for places that can't render
// HTML (e.g. a work order's plain "Internal Notes" / "Work Performed" fields). Block
// boundaries and <br> become newlines; list items get a bullet. Images are dropped.
export function htmlToText(html) {
  if (!html) return '';
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}
