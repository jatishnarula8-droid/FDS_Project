import type { PunchQueue, QueueItem } from './queue.js';

export interface SenderOptions {
  url: string;
  secret: string;
  batchSize?: number;
  maxAttemptsPerRequest?: number;
  /** After this many per-punch server errors a punch is moved to the dead-letter file. */
  maxPunchErrors?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

export interface FlushResult { sent: number; remaining: number; offline: boolean; fatal?: string }

/** Batches queued punches, POSTs them over HTTPS with the shared-secret header, retries with exponential backoff. */
export class Sender {
  private readonly o: Required<SenderOptions>;
  constructor(private readonly queue: PunchQueue, opts: SenderOptions) {
    this.o = {
      batchSize: 100, maxAttemptsPerRequest: 4, maxPunchErrors: 10,
      fetchImpl: fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), log: console.log,
      ...opts,
    };
  }

  /** Best-effort "these machines are alive" ping. Never queued: a missed heartbeat is harmless. */
  async heartbeat(serials: string[]): Promise<void> {
    if (!serials.length) return;
    try {
      await this.o.fetchImpl(this.o.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-secret': this.o.secret },
        body: JSON.stringify({ punches: [], heartbeats: serials }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch { /* offline: ignore */ }
  }

  async flush(): Promise<FlushResult> {
    let sent = 0;
    while (this.queue.size > 0) {
      const batch = this.queue.peek(this.o.batchSize);
      const res = await this.post(batch);
      if (res.kind === 'offline') return { sent, remaining: this.queue.size, offline: true };
      if (res.kind === 'fatal') return { sent, remaining: this.queue.size, offline: false, fatal: res.message };
      if (res.kind === 'rejected') { this.queue.deadLetter(batch, res.message); this.o.log(`[sender] batch rejected (${res.message}); moved to dead-letter`); continue; }

      const done = new Set<QueueItem>(); const retry = new Set<QueueItem>(); const dead: QueueItem[] = [];
      const counts: Record<string, number> = {};
      res.results.forEach((r, i) => {
        const item = batch[r.index ?? i]; if (!item) return;
        counts[r.status] = (counts[r.status] ?? 0) + 1;
        if (r.status === 'error') {
          if (item.attempts + 1 >= this.o.maxPunchErrors) dead.push(item); else retry.add(item);
        } else done.add(item);
      });
      // Anything the server did not report on stays queued.
      for (const it of batch) if (!done.has(it) && !retry.has(it) && !dead.includes(it)) retry.add(it);
      this.queue.settle(done, retry);
      if (dead.length) this.queue.deadLetter(dead, 'server_error_repeatedly');
      sent += done.size;
      this.o.log(`[sender] delivered ${done.size}/${batch.length} ${JSON.stringify(counts)}; queue=${this.queue.size}`);
      if (retry.size > 0) return { sent, remaining: this.queue.size, offline: false }; // some punches errored server-side; retry on the next tick
    }
    return { sent, remaining: 0, offline: false };
  }

  private async post(batch: QueueItem[]): Promise<
    | { kind: 'ok'; results: { index?: number; status: string }[] }
    | { kind: 'offline' } | { kind: 'fatal'; message: string } | { kind: 'rejected'; message: string }> {
    const body = JSON.stringify({ punches: batch.map((b) => b.punch) });
    for (let attempt = 1; attempt <= this.o.maxAttemptsPerRequest; attempt++) {
      try {
        const resp = await this.o.fetchImpl(this.o.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-device-secret': this.o.secret },
          body,
          signal: AbortSignal.timeout(20_000),
        });
        if (resp.ok) return { kind: 'ok', results: ((await resp.json()) as any).results ?? [] };
        if (resp.status === 401 || resp.status === 403) return { kind: 'fatal', message: `HTTP ${resp.status}: check DEVICE_INGEST_SECRET` };
        if (resp.status >= 400 && resp.status < 500 && resp.status !== 408 && resp.status !== 429) {
          return { kind: 'rejected', message: `HTTP ${resp.status} ${(await resp.text()).slice(0, 200)}` };
        }
        this.o.log(`[sender] HTTP ${resp.status} (attempt ${attempt}/${this.o.maxAttemptsPerRequest})`);
      } catch (e) {
        this.o.log(`[sender] network error (attempt ${attempt}/${this.o.maxAttemptsPerRequest}): ${(e as Error).message}`);
      }
      if (attempt < this.o.maxAttemptsPerRequest) {
        const backoff = Math.min(30_000, 1000 * 2 ** (attempt - 1));
        await this.o.sleep(backoff + Math.random() * 250);
      }
    }
    return { kind: 'offline' };
  }
}
