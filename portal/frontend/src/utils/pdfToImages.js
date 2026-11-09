import * as pdfjsLib from 'pdfjs-dist';

// The ?v= suffix busts browser caches. nginx used to serve this .mjs as
// application/octet-stream; browsers cached it that way, and a 304 revalidation
// carries no Content-Type, so the bad type stuck even after nginx was fixed.
// Bump it if the worker ever needs to be re-fetched everywhere again.
pdfjsLib.GlobalWorkerOptions.workerSrc = `${new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).href}?v=2`;

// Render each page of a PDF (given as ArrayBuffer) to a JPEG data URL.
// Returns an array of data URLs, one per page.
export async function pdfToImages(arrayBuffer, scale = 1.5) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  const images = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    images.push(canvas.toDataURL('image/jpeg', 0.88));
  }
  return images;
}
