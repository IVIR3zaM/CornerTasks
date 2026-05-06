import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  payload: string;
  size?: number;
  downloadName?: string;
}

// Renders the payload as a QR code <img>. When `downloadName` is set, also
// shows a "Download QR" link that saves the same data URL as a PNG file.
export function QRCodeImage({ payload, size = 220, downloadName }: Props): JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: size })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [payload, size]);

  if (!dataUrl) {
    return (
      <div className="qr-placeholder" style={{ width: size, height: size }} aria-label="QR code loading" />
    );
  }
  return (
    <div className="qr-block">
      <img src={dataUrl} alt="Account mnemonic QR code" width={size} height={size} />
      {downloadName ? (
        <a href={dataUrl} download={downloadName} className="btn-text">Download QR</a>
      ) : null}
    </div>
  );
}
