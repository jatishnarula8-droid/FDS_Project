import type { DeviceAdapter, RawPunch } from '../types.js';

export interface MockOptions {
  serials: string[];
  intervalSeconds: number;
  firstPin: number;
  lastPin: number;
  /** "HH:mm" in IST: stamp punches with this time today instead of the real clock. */
  mealTime?: string;
}

/**
 * Generates believable fake punches so the whole pipeline can be demoed with no hardware:
 * mostly normal punches, plus some accidental double-punches, strangers' PINs and exact re-sends,
 * so you can see matched / duplicate / unmatched and idempotency in the live feed.
 */
export class MockAdapter implements DeviceAdapter {
  readonly name = 'mock';
  private buffer: RawPunch[] = [];
  private timer?: NodeJS.Timeout;
  private last?: RawPunch;

  constructor(private readonly o: MockOptions) {}

  async start() {
    this.timer = setInterval(() => this.generate(), this.o.intervalSeconds * 1000);
    this.generate();
  }
  async stop() { if (this.timer) clearInterval(this.timer); }
  async fetchNewPunches() { const out = this.buffer; this.buffer = []; return out; }
  drainHeartbeats() { return this.o.serials; }

  private now(): string {
    if (!this.o.mealTime) return new Date().toISOString();
    const ist = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const base = new Date(`${ist}T${this.o.mealTime}:00+05:30`).getTime();
    return new Date(base + Math.floor(Math.random() * 3600) * 1000).toISOString(); // spread across the next hour
  }

  private generate() {
    const r = Math.random();
    let p: RawPunch;
    if (r < 0.08 && this.last) {
      // same person punches again a minute later -> "duplicate"
      p = { ...this.last, punched_at: new Date(new Date(this.last.punched_at).getTime() + 60_000).toISOString() };
    } else if (r < 0.12 && this.last) {
      // exact re-send of a previous punch (what a retry looks like) -> replayed, no double charge
      p = { ...this.last };
    } else if (r < 0.17) {
      p = this.make(String(9000 + Math.floor(Math.random() * 99))); // unknown PIN -> "unmatched"
    } else {
      const pin = this.o.firstPin + Math.floor(Math.random() * (this.o.lastPin - this.o.firstPin + 1));
      p = this.make(String(pin));
    }
    this.last = p;
    this.buffer.push(p);
  }

  private make(pin: string): RawPunch {
    const serial = this.o.serials[Math.floor(Math.random() * this.o.serials.length)];
    return { device_serial: serial, device_user_id: pin, punched_at: this.now(), verify_mode: 1, raw: { source: 'mock' } };
  }
}
