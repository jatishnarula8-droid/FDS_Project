'use client';

import { QRCodeSVG } from 'qrcode.react';

/** The QR encodes "MESS:<token>". White background + margin keeps it scannable in dark mode too. */
export function QrPass({ token, label }: { token: string; label: string }) {
  return (
    <div className="inline-block rounded-lg border bg-white p-3" role="img" aria-label={`QR pass for ${label}`}>
      <QRCodeSVG value={`MESS:${token}`} size={168} level="M" bgColor="#ffffff" fgColor="#111111" />
    </div>
  );
}
