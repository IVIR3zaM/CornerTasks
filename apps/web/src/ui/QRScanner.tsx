import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

interface Props {
  onResult(text: string): void;
  onCancel(): void;
}

// Camera-based QR scan. Decodes via jsqr from <canvas> snapshots of the
// <video> element. requestAnimationFrame loop stops on the first valid frame.
// HTTPS is required for getUserMedia — satisfied by the iteration-3 CloudFront/S3 setup.
export function QRScanner({ onResult, onCancel }: Props): JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const start = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        canvasRef.current = document.createElement('canvas');
        scan();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start camera.');
      }
    };

    const scan = (): void => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const img = ctx.getImageData(0, 0, w, h);
            const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
            if (code && code.data) {
              onResult(code.data);
              return;
            }
          }
        }
      }
      rafRef.current = requestAnimationFrame(scan);
    };

    void start();
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [onResult]);

  return (
    <div className="qr-scanner">
      {error ? (
        <div className="qr-error">
          <p>{error}</p>
          <p className="muted">Camera access requires HTTPS. Try pasting the mnemonic instead.</p>
        </div>
      ) : (
        <video ref={videoRef} className="qr-video" muted playsInline />
      )}
      <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
    </div>
  );
}
