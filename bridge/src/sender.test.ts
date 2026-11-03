import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PunchQueue } from './queue.js';
import { Sender } from './sender.js';
import { AdmsPushAdapter } from './adapters/adms.js';
import type { RawPunch } from './types.js';

const punch = (i: number): RawPunch => ({ device_serial: 'D', device_user_id: String(i), punched_at: '2025-01-01T12:00:00+05:30' });
const mk = () => new PunchQueue(mkdtempSync(join(tmpdir(), 'bridge-')));
const ok = (n: number, status = 'matched') => new Response(JSON.stringify({ results: Array.from({ length: n }, (_, index) => ({ index, status })) }), { status: 200 });
const opts = (f: typeof fetch) => ({ url: 'https://x/y', secret: 's3cret-s3cret', fetchImpl: f, sleep: async () => {}, log: () => {} });

test('delivers a batch with the secret header and empties the queue', async () => {
  const q = mk(); q.push([punch(1), punch(2)]);
  let seen: any;
  const r = await new Sender(q, opts((async (_u: any, init: any) => { seen = init; return ok(2); }) as any)).flush();
  assert.equal(r.sent, 2); assert.equal(q.size, 0);
  assert.equal(seen.headers['x-device-secret'], 's3cret-s3cret');
});

test('retries 5xx with backoff and succeeds', async () => {
  const q = mk(); q.push([punch(1)]);
  let calls = 0;
  const r = await new Sender(q, opts((async () => (++calls < 3 ? new Response('bad', { status: 503 }) : ok(1))) as any)).flush();
  assert.equal(calls, 3); assert.equal(r.sent, 1);
});

test('offline: keeps punches in the persisted queue, and a restart finds them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
  const q = new PunchQueue(dir); q.push([punch(1), punch(2), punch(3)]);
  const r = await new Sender(q, opts((async () => { throw new Error('ENOTFOUND'); }) as any)).flush();
  assert.equal(r.offline, true); assert.equal(q.size, 3);
  assert.equal(new PunchQueue(dir).size, 3, 'survives restart');
});

test('401 is fatal and keeps the queue (wrong secret must not lose punches)', async () => {
  const q = mk(); q.push([punch(1)]);
  const r = await new Sender(q, opts((async () => new Response('no', { status: 401 })) as any)).flush();
  assert.ok(r.fatal); assert.equal(q.size, 1);
});

test('400 (poison batch) is dead-lettered so it cannot block the queue', async () => {
  const q = mk(); q.push([punch(1)]);
  await new Sender(q, opts((async () => new Response('invalid', { status: 400 })) as any)).flush();
  assert.equal(q.size, 0);
});

test('duplicate / unmatched statuses count as delivered (server already stored them)', async () => {
  const q = mk(); q.push([punch(1)]);
  const r = await new Sender(q, opts((async () => ok(1, 'duplicate')) as any)).flush();
  assert.equal(r.sent, 1); assert.equal(q.size, 0);
});

test('per-punch server error stays queued for retry', async () => {
  const q = mk(); q.push([punch(1), punch(2)]);
  const f = (async () => new Response(JSON.stringify({ results: [{ index: 0, status: 'matched' }, { index: 1, status: 'error' }] }), { status: 200 })) as any;
  const r = await new Sender(q, opts(f)).flush();
  assert.equal(r.sent, 1); assert.equal(q.size, 1);
});

test('ADMS parser reads ATTLOG lines and ignores junk', () => {
  const a = new AdmsPushAdapter({ port: 0, utcOffset: '+05:30', allowedIps: [] });
  const out = a.parseAttLog('SN1', '1001\t2025-01-31 12:30:05\t0\t1\t0\n\nbad line\n1002\t2025-01-31 12:31:00\t0\t15\t0');
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].device_user_id, out[0].punched_at, out[0].verify_mode], ['1001', '2025-01-31T12:30:05+05:30', 1]);
  assert.equal(out[1].verify_mode, 15);
});
