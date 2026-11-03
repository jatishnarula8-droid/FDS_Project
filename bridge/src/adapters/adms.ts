import { createServer, type Server } from 'node:http';
import type { DeviceAdapter, DeviceConfig, RawPunch } from '../types.js';

/**
 * AdmsPushAdapter — a tiny HTTP server that eSSL/ZKTeco machines push to ("Cloud Server"/ADMS setting on the device:
 * point it at this PC's LAN IP and ADMS_PORT). Machines send requests like:
 *     GET  /iclock/cdata?SN=<serial>&options=all&pushver=...      (handshake — we reply with a config block)
 *     POST /iclock/cdata?SN=<serial>&table=ATTLOG&Stamp=...       (body = tab-separated attendance lines)
 *     GET  /iclock/getrequest?SN=<serial>                          (command poll — we reply OK)
 *
 * // TODO: verify against your eSSL model's protocol. Field order of ATTLOG lines and the handshake reply vary a
 *   little between firmware versions. Capture one real request (set LOG_RAW=1) and adjust parseAttLog() if needed.
 *
 * PRIVACY: only the ATTLOG table is read. USERINFO / FP / FACE / BIOPHOTO tables (which carry biometric templates)
 * are acknowledged with OK and DISCARDED without being parsed, stored or forwarded.
 */
export class AdmsPushAdapter implements DeviceAdapter {
  readonly name = 'adms';
  private buffer: RawPunch[] = [];
  private server?: Server;
  private seen = new Set<string>();

  drainHeartbeats() { const s = [...this.seen]; this.seen.clear(); return s; }

  constructor(private readonly o: { port: number; utcOffset: string; allowedIps: string[]; log?: (m: string) => void }) {}

  async start() {
    const log = this.o.log ?? console.log;
    this.server = createServer((req, res) => {
      const ip = (req.socket.remoteAddress ?? '').replace('::ffff:', '');
      if (this.o.allowedIps.length && !this.o.allowedIps.includes(ip)) { res.writeHead(403).end('forbidden'); return; }

      const url = new URL(req.url ?? '/', 'http://x');
      const sn = url.searchParams.get('SN') ?? '';
      if (sn) this.seen.add(sn); // any request from a machine counts as a heartbeat
      const chunks: Buffer[] = [];
      req.on('data', (c) => { chunks.push(c); if (Buffer.concat(chunks).length > 5_000_000) req.destroy(); });
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (process.env.LOG_RAW) log(`[adms] ${req.method} ${req.url} from ${ip}\n${body.slice(0, 500)}`);

        if (url.pathname === '/iclock/cdata' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/plain' });
          res.end([`GET OPTION FROM: ${sn}`, 'ErrorDelay=60', 'Delay=30', 'TransTimes=00:00;14:05', 'TransInterval=1',
                   'TransFlag=TransData AttLog', 'Realtime=1', 'Encrypt=0'].join('\n'));
          return;
        }
        if (url.pathname === '/iclock/cdata' && req.method === 'POST') {
          if (url.searchParams.get('table') === 'ATTLOG') {
            const punches = this.parseAttLog(sn, body);
            this.buffer.push(...punches);
            log(`[adms] ${sn}: received ${punches.length} punch(es)`);
          }
          res.writeHead(200, { 'content-type': 'text/plain' }).end('OK');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/plain' }).end('OK'); // getrequest, devicecmd, anything else
      });
    });
    await new Promise<void>((resolve) => this.server!.listen(this.o.port, '0.0.0.0', resolve));
    log(`[adms] listening on :${this.o.port} (point the machine's cloud-server setting here)`);
  }

  async stop() { await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r())); }

  async fetchNewPunches() { const out = this.buffer; this.buffer = []; return out; }

  /** Line format (typical): PIN \t YYYY-MM-DD HH:MM:SS \t Status \t Verify \t WorkCode \t ... */
  parseAttLog(serial: string, body: string): RawPunch[] {
    const out: RawPunch[] = [];
    for (const line of body.split(/\r?\n/)) {
      const f = line.split('\t');
      if (f.length < 2) continue;
      const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(f[1].trim());
      if (!m) continue;
      const verify = Number.parseInt(f[3] ?? '', 10);
      out.push({
        device_serial: serial,
        device_user_id: f[0].trim(),
        punched_at: `${m[1]}T${m[2]}${this.o.utcOffset}`,
        verify_mode: Number.isNaN(verify) ? null : verify,
        raw: { status: f[2]?.trim() },
      });
    }
    return out;
  }
}

export const allowedIpsFrom = (devices: DeviceConfig[]) => devices.map((d) => d.ip);
