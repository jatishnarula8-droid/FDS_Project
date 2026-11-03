import { loadConfig } from './config.js';
import { PunchQueue } from './queue.js';
import { Sender } from './sender.js';
import { MockAdapter } from './adapters/mock.js';
import { PullAdapter } from './adapters/pull.js';
import { AdmsPushAdapter, allowedIpsFrom } from './adapters/adms.js';
import type { DeviceAdapter } from './types.js';

const cfg = loadConfig();

function buildAdapter(): DeviceAdapter {
  switch (cfg.ADAPTER) {
    case 'mock':
      return new MockAdapter({
        serials: cfg.devices.length ? cfg.devices.map((d) => d.serial) : ['MOCK-DEV-001', 'MOCK-DEV-002'],
        intervalSeconds: cfg.MOCK_INTERVAL_SECONDS, firstPin: cfg.MOCK_FIRST_PIN, lastPin: cfg.MOCK_LAST_PIN,
        mealTime: cfg.MOCK_MEAL_TIME,
      });
    case 'adms':
      return new AdmsPushAdapter({ port: cfg.ADMS_PORT, utcOffset: cfg.DEVICE_UTC_OFFSET, allowedIps: allowedIpsFrom(cfg.devices) });
    default:
      return new PullAdapter(cfg.devices, { utcOffset: cfg.DEVICE_UTC_OFFSET, dataDir: cfg.DATA_DIR, backfillHours: cfg.PULL_BACKFILL_HOURS });
  }
}

const adapter = buildAdapter();
const queue = new PunchQueue(cfg.DATA_DIR);
const sender = new Sender(queue, { url: cfg.INGEST_URL, secret: cfg.DEVICE_INGEST_SECRET });
const everyMs = (cfg.ADAPTER === 'mock' ? Math.min(cfg.POLL_INTERVAL_SECONDS, 3) : cfg.POLL_INTERVAL_SECONDS) * 1000;

console.log(`[bridge] adapter=${adapter.name} -> ${cfg.INGEST_URL}`);
console.log(`[bridge] queue has ${queue.size} unsent punch(es) from a previous run`);

let busy = false;
let lastHeartbeat = 0;
async function tick() {
  if (busy) return; // never overlap ticks
  busy = true;
  try {
    const fresh = await adapter.fetchNewPunches();
    const hb = adapter.drainHeartbeats?.() ?? [];
    if (hb.length && Date.now() - lastHeartbeat > 30_000) { lastHeartbeat = Date.now(); await sender.heartbeat(hb); }
    if (fresh.length) { queue.push(fresh); console.log(`[bridge] +${fresh.length} punch(es) queued`); }
    if (queue.size) {
      const r = await sender.flush();
      if (r.fatal) console.error(`[bridge] FATAL: ${r.fatal} — punches stay queued until fixed`);
      else if (r.offline) console.warn(`[bridge] cloud unreachable; ${r.remaining} punch(es) kept in the local queue`);
    }
  } catch (e) {
    console.error('[bridge] tick failed:', e);
  } finally { busy = false; }
}

await adapter.start?.();
void tick();
const timer = setInterval(tick, everyMs);

async function shutdown() {
  clearInterval(timer);
  await adapter.stop?.();
  console.log('[bridge] stopped; unsent punches remain in', cfg.DATA_DIR);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
