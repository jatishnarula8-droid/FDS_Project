import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import ZKLib from 'node-zklib';
import type { DeviceAdapter, DeviceConfig, RawPunch } from '../types.js';

/**
 * PullAdapter — polls each eSSL / ZKTeco machine over TCP (default port 4370) and returns new attendance rows.
 *
 * // TODO: verify against your eSSL model's protocol.
 *   - Confirm the machine answers on TCP 4370 (not all firmware has "Comm Key"/TCP enabled by default).
 *   - Confirm node-zklib's getAttendances() works on your firmware; some need `getAttendances(cb)` or UDP (inport 5200).
 *   - Confirm which clock the machine uses. node-zklib builds `recordTime` from the device's wall-clock fields
 *     using the *bridge computer's* local timezone, so we re-read those local fields and stamp them with
 *     DEVICE_UTC_OFFSET (default +05:30). Check one real punch end-to-end before trusting the offset.
 * Only deviceUserId + timestamp are used. Fingerprint/face templates are never requested.
 */
export class PullAdapter implements DeviceAdapter {
  readonly name = 'pull';
  private lastSeen: Record<string, string> = {}; // serial -> ISO of newest punch already returned
  private reachable = new Set<string>();

  drainHeartbeats() { const s = [...this.reachable]; this.reachable.clear(); return s; }
  private readonly stateFile: string;

  constructor(
    private readonly devices: DeviceConfig[],
    private readonly o: { utcOffset: string; dataDir: string; backfillHours: number; log?: (m: string) => void },
  ) {
    mkdirSync(o.dataDir, { recursive: true });
    this.stateFile = join(o.dataDir, 'state.json');
    if (existsSync(this.stateFile)) { try { this.lastSeen = JSON.parse(readFileSync(this.stateFile, 'utf8')); } catch { /* start fresh */ } }
  }

  async fetchNewPunches(): Promise<RawPunch[]> {
    const log = this.o.log ?? console.log;
    const out: RawPunch[] = [];
    for (const dev of this.devices) {
      const zk = new ZKLib(dev.ip, dev.port, 10_000, 4_000);
      try {
        await zk.createSocket();
        this.reachable.add(dev.serial);
        const { data } = await zk.getAttendances();
        const since = this.lastSeen[dev.serial]
          ? new Date(this.lastSeen[dev.serial]).getTime()
          : Date.now() - this.o.backfillHours * 3600e3;
        let newest = since;
        for (const rec of data) {
          const iso = this.toIso(rec.recordTime);
          const t = new Date(iso).getTime();
          if (t <= since) continue;
          out.push({ device_serial: dev.serial, device_user_id: String(rec.deviceUserId), punched_at: iso, verify_mode: null, raw: { userSn: rec.userSn } });
          if (t > newest) newest = t;
        }
        this.lastSeen[dev.serial] = new Date(newest).toISOString();
        log(`[pull] ${dev.name} (${dev.ip}): ${data.length} records on device`);
      } catch (e) {
        log(`[pull] ${dev.name} (${dev.ip}) unreachable: ${(e as Error).message}`); // other devices still polled
      } finally {
        try { await zk.disconnect(); } catch { /* socket may never have opened */ }
      }
    }
    writeFileSync(this.stateFile, JSON.stringify(this.lastSeen));
    return out;
  }

  private toIso(d: Date): string {
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${this.o.utcOffset}`;
  }
}
