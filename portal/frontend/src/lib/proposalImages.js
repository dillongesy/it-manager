// Turn a work order's attached proposals into printable page images.
//
// This used to live inline in each caller as a `try { … } catch { /* skip */ }`, which
// meant a proposal that COULDN'T be rendered was dropped silently: the printout still
// listed it in the Proposals summary, but the document itself never appeared, and the
// only trace was a console warning nobody was watching. On a customer-facing invoice
// that is the worst possible failure mode, so every reason a proposal can fail is now
// collected and handed back for the caller to show.
//
// Two things could fail invisibly before:
//   • a NON-PDF proposal (a scanned JPEG/PNG quote) — pdf.js rejects anything without a
//     %PDF header, so it was skipped. Images now render directly, no pdf.js involved.
//   • a genuinely unrenderable attachment (.docx, .xlsx) — still can't be printed, but
//     now it says so instead of quietly vanishing.

import api from '../api/client.js';
// pdf.js is large; it's loaded the first time a PDF proposal is rendered.
const pdfToImages = async (...args) => (await import('../utils/pdfToImages.js')).pdfToImages(...args);

const extensionOf = (name) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(name ?? ''));
  return m ? m[1].toLowerCase() : '';
};

// Trust the stored MIME type first, fall back to the filename — older uploads and some
// browsers store a generic application/octet-stream.
const isPdf = (mime, name) =>
  String(mime ?? '').toLowerCase().includes('pdf') || extensionOf(name) === 'pdf';

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];
const isImage = (mime, name) =>
  String(mime ?? '').toLowerCase().startsWith('image/') || IMAGE_EXTS.includes(extensionOf(name));

// Bytes → data: URL, so the image can be embedded in the print window (which is a
// separate about:blank document with no access to our blob URLs or auth headers).
function bufferToDataUrl(buffer, mimeType) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('the file could not be read'));
    reader.readAsDataURL(new Blob([buffer], { type: mimeType || 'application/octet-stream' }));
  });
}

/** One proposal's bytes → an array of page images (data URLs). Throws with a
 *  plain-language reason the caller can show as-is. */
export async function renderProposalPages(buffer, mimeType, name) {
  if (isPdf(mimeType, name)) {
    try {
      return await pdfToImages(buffer);
    } catch (err) {
      // The most common cause here isn't a corrupt file, it's the pdf.js worker
      // failing to load (e.g. a web server handing back .mjs with the wrong
      // Content-Type), which takes down EVERY proposal at once. Say enough for that
      // to be recognisable.
      throw new Error(`the PDF could not be rendered (${err?.message || 'unknown error'})`);
    }
  }
  if (isImage(mimeType, name)) {
    return [await bufferToDataUrl(buffer, mimeType)];
  }
  const ext = extensionOf(name);
  throw new Error(
    `${ext ? `.${ext} files` : 'this file type'} can't be printed — save it as a PDF and re-upload it`
  );
}

/**
 * Render every proposal attached to a work order.
 * Returns { images, failures }:
 *   images   → [{ name, pages: [dataUrl] }] ready for printWorkOrder()
 *   failures → [{ name, reason }] — proposals that will be MISSING from the printout
 * Never throws: one bad attachment must not block printing the work order.
 */
export async function loadProposalImages(wo) {
  const images = [];
  const failures = [];

  for (const p of wo?.wo_proposals ?? []) {
    const name = p.proposal_name || 'Unnamed proposal';
    if (!p.proposal_file_id) {
      failures.push({ name, reason: 'the file is no longer on the customer record' });
      continue;
    }
    try {
      const res = await api.get(
        `/customers/${wo.customer_id}/files/${p.proposal_file_id}/download`,
        { responseType: 'arraybuffer', params: { inline: 1 } }
      );
      const pages = await renderProposalPages(res.data, p.proposal_mime_type, name);
      if (!pages.length) throw new Error('it has no pages');
      images.push({ name, pages });
    } catch (err) {
      failures.push({ name, reason: err?.message || 'it could not be loaded' });
    }
  }
  return { images, failures };
}

/** A message listing what will be left out, or '' when everything rendered. */
export function missingProposalsMessage(failures) {
  if (!failures.length) return '';
  const list = failures.map((f) => `• ${f.name} — ${f.reason}`).join('\n');
  const many = failures.length > 1;
  return `${many ? `${failures.length} proposals` : 'A proposal'} could not be attached to this printout:\n\n${list}\n\n`
       + `The work order will print without ${many ? 'them' : 'it'}.`;
}
