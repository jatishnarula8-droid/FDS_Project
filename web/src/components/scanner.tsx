'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, XCircle, Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { redeemPass, type ScanResult } from '@/app/actions/staff';

const REGION = 'qr-region';

/** Staff scan screen: camera scanning (html5-qrcode) plus a paste-the-code fallback for laptops without a camera. */
export function Scanner() {
  const [result, setResult] = useState<(ScanResult & { at: number }) | null>(null);
  const [history, setHistory] = useState<{ text: string; ok: boolean }[]>([]);
  const [camera, setCamera] = useState<'idle' | 'on' | 'error'>('idle');
  const [camError, setCamError] = useState('');
  const [busy, setBusy] = useState(false);
  const last = useRef({ token: '', at: 0 });
  const scanner = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  const submit = useCallback(async (raw: string) => {
    const token = raw.trim();
    if (!token || (token === last.current.token && Date.now() - last.current.at < 4000)) return; // ignore repeat frames
    last.current = { token, at: Date.now() };
    setBusy(true);
    const r = await redeemPass(token);
    setBusy(false);
    setResult({ ...r, at: Date.now() });
    setHistory((h) => [{ ok: r.ok, text: r.ok ? `${r.student_name} · ${r.meal}` : r.error }, ...h].slice(0, 8));
  }, []);

  async function startCamera() {
    setCamError('');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const s = new Html5Qrcode(REGION);
      await s.start({ facingMode: 'environment' }, { fps: 8, qrbox: { width: 240, height: 240 } }, (text) => void submit(text), () => {});
      scanner.current = s;
      setCamera('on');
    } catch (e) {
      setCamera('error');
      setCamError('Could not open the camera (allow camera access, and use https or localhost). You can paste the code below instead.');
    }
  }
  useEffect(() => () => { void scanner.current?.stop().then(() => scanner.current?.clear()).catch(() => {}); }, []);

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-lg border bg-muted">
        <div id={REGION} className="mx-auto max-w-sm" />
        {camera !== 'on' && (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <Camera className="h-8 w-8 text-muted-foreground" aria-hidden />
            <Button onClick={startCamera} type="button">Start camera</Button>
            {camError && <p role="alert" className="text-sm text-destructive">{camError}</p>}
          </div>
        )}
      </div>

      <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const v = new FormData(f).get('code'); void submit(String(v ?? '')); f.reset(); }} className="flex gap-2">
        <Input name="code" placeholder="…or paste the code (MESS:…)" aria-label="QR code text" autoComplete="off" />
        <Button type="submit" variant="secondary" disabled={busy}>Check</Button>
      </form>

      <div aria-live="assertive" role="status">
        {result && (result.ok ? (
          <div className="flex items-start gap-3 rounded-lg border-2 border-success bg-success/10 p-4">
            <CheckCircle2 className="h-8 w-8 shrink-0 text-success" aria-hidden />
            <div>
              <p className="text-lg font-semibold">Serve: {result.meal}</p>
              <p>{result.student_name} <span className="text-muted-foreground">{result.roll_no}</span></p>
              {result.low_balance && <p className="mt-1 text-sm font-medium text-warning">Their balance is almost finished.</p>}
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border-2 border-destructive bg-destructive/10 p-4">
            <XCircle className="h-8 w-8 shrink-0 text-destructive" aria-hidden />
            <div><p className="text-lg font-semibold">Do not serve</p><p>{result.error}</p></div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <div>
          <h2 className="mb-1 text-sm font-medium">Recent scans</h2>
          <ul className="divide-y text-sm">
            {history.map((h, i) => (<li key={i} className="flex items-center gap-2 py-1.5">{h.ok ? <CheckCircle2 className="h-4 w-4 text-success" aria-label="served" /> : <XCircle className="h-4 w-4 text-destructive" aria-label="refused" />}{h.text}</li>))}
          </ul>
        </div>
      )}
    </div>
  );
}
