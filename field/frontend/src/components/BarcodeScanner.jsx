import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { DecodeHintType, BarcodeFormat } from '@zxing/library';

// Formats worth scanning for our own + manufacturer barcodes (product UPC/EAN, our
// Code-128/39, plus QR / DataMatrix). Limiting the set speeds up decoding.
const FORMATS = [
  BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
  BarcodeFormat.ITF, BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE, BarcodeFormat.DATA_MATRIX,
];

// Downscale frames before decoding — plenty of detail for a barcode and much faster.
const MAX_EDGE = 720;

/**
 * Full-screen camera barcode/QR scanner.
 *
 * We drive the camera ourselves (rather than letting a library own the <video>) so
 * the preview always fills the screen correctly, and so we can decode each frame at
 * BOTH 0° and 90°. That lets a sideways (vertical) barcode be read while the phone
 * is held normally in portrait — no need to rotate the phone.
 *
 * Calls onScan(decodedText) on the first successful read, then stops.
 */
export default function BarcodeScanner({ onScan, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const handledRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // getUserMedia only works in a secure context: HTTPS or localhost.
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('Camera scanning needs a secure (HTTPS) connection. Open this site over https:// — over the LAN, run the field app with "npm run dev:https" and accept the certificate warning. (Plain http only allows the camera on localhost.)');
      return;
    }

    const hints = new Map();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    const reader = new BrowserMultiFormatReader(hints);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let cancelled = false;
    let rotated = false; // alternate 0° / 90° each tick

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        video.srcObject = stream;
        await video.play();
        loop();
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Unable to access camera');
      }
    }

    function loop() {
      if (cancelled || handledRef.current) return;
      tick();
      timerRef.current = setTimeout(loop, 90);
    }

    function tick() {
      const video = videoRef.current;
      if (!video || video.readyState < 2 || !video.videoWidth) return;

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.min(1, MAX_EDGE / Math.max(vw, vh));
      const dw = Math.round(vw * scale);
      const dh = Math.round(vh * scale);

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!rotated) {
        canvas.width = dw;
        canvas.height = dh;
        ctx.drawImage(video, 0, 0, dw, dh);
      } else {
        // Rotate the frame 90° so a vertical barcode lands horizontal for the reader.
        canvas.width = dh;
        canvas.height = dw;
        ctx.translate(dh / 2, dw / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
      }

      try {
        const result = reader.decodeFromCanvas(canvas);
        if (result && !handledRef.current) {
          handledRef.current = true;
          cleanup();
          onScan(result.getText());
        }
      } catch {
        // No barcode in this frame/orientation — expected; try the other next tick.
      }
      rotated = !rotated;
    }

    function cleanup() {
      cancelled = true;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    }

    start();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClose = () => {
    handledRef.current = true;
    const stream = streamRef.current;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (timerRef.current) clearTimeout(timerRef.current);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Live preview fills the screen */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* Top bar */}
      <div className="relative flex items-center justify-between p-4 safe-top bg-linear-to-b from-black/70 to-transparent">
        <h2 className="text-white font-semibold">Scan barcode</h2>
        <button
          onClick={handleClose}
          className="text-gray-200 hover:text-white text-2xl leading-none w-9 h-9 flex items-center justify-center"
          aria-label="Close scanner"
        >
          ×
        </button>
      </div>

      {/* Centered aiming frame (cosmetic — the whole frame is decoded, both orientations) */}
      <div className="relative flex-1 flex items-center justify-center pointer-events-none">
        {!error && (
          <div className="w-[78%] max-w-sm aspect-square rounded-2xl border-2 border-white/70 shadow-[0_0_0_100vmax_rgba(0,0,0,0.35)]" />
        )}
      </div>

      {/* Bottom hint / error */}
      <div className="relative p-6 safe-bottom bg-linear-to-t from-black/70 to-transparent text-center">
        {error ? (
          <p className="text-brand text-sm">{error}</p>
        ) : (
          <p className="text-gray-200 text-sm">
            Center the barcode in the box
          </p>
        )}
      </div>
    </div>
  );
}
