import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawPunch } from './types.js';

export interface QueueItem { punch: RawPunch; attempts: number }

/**
 * Durable FIFO of punches waiting to be delivered. Persisted to a JSON file after every change so a power cut
 * or an internet outage never loses punches. Re-sending is always safe: the cloud insert is idempotent.
 */
export class PunchQueue {
  private items: QueueItem[] = [];
  private readonly file: string;
  private readonly deadFile: string;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'queue.json');
    this.deadFile = join(dir, 'dead-letter.jsonl');
    if (existsSync(this.file)) {
      try { this.items = JSON.parse(readFileSync(this.file, 'utf8')); }
      catch { console.error(`[queue] ${this.file} is corrupt; starting empty (old file kept as .corrupt)`);
              renameSync(this.file, this.file + '.corrupt'); }
    }
  }

  get size() { return this.items.length; }

  push(punches: RawPunch[]) {
    for (const punch of punches) this.items.push({ punch, attempts: 0 });
    this.persist();
  }

  peek(n: number): QueueItem[] { return this.items.slice(0, n); }

  /** Remove delivered items (by identity) and bump attempts for the ones to keep. */
  settle(done: Set<QueueItem>, retry: Set<QueueItem>) {
    for (const it of retry) it.attempts += 1;
    this.items = this.items.filter((it) => !done.has(it));
    this.persist();
  }

  /** Move items we will never be able to deliver aside, so one bad punch cannot block the queue forever. */
  deadLetter(items: QueueItem[], reason: string) {
    const set = new Set(items);
    for (const it of items) appendFileSync(this.deadFile, JSON.stringify({ reason, at: new Date().toISOString(), ...it }) + '\n');
    this.items = this.items.filter((it) => !set.has(it));
    this.persist();
  }

  private persist() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.items));
    renameSync(tmp, this.file); // atomic replace
  }
}
