import 'dotenv/config';
import { z } from 'zod';
import type { DeviceConfig } from './types.js';

const DeviceSchema = z.object({
  name: z.string(),
  serial: z.string().min(1),
  ip: z.string().min(1),
  port: z.number().int().default(4370),
});

const EnvSchema = z.object({
  INGEST_URL: z.string().url(),
  DEVICE_INGEST_SECRET: z.string().min(8),
  DEVICES: z.string().default('[]'),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
  ADAPTER: z.enum(['mock', 'pull', 'adms']).default('pull'),
  ADMS_PORT: z.coerce.number().int().default(8081),
  DEVICE_UTC_OFFSET: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('+05:30'),
  MOCK_INTERVAL_SECONDS: z.coerce.number().min(0.5).default(4),
  MOCK_FIRST_PIN: z.coerce.number().int().default(1001),
  MOCK_LAST_PIN: z.coerce.number().int().default(1030),
  MOCK_MEAL_TIME: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  PULL_BACKFILL_HOURS: z.coerce.number().default(48),
  DATA_DIR: z.string().default('./data'),
});

export type Config = z.infer<typeof EnvSchema> & { devices: DeviceConfig[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    console.error('Invalid bridge configuration:\n', parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'));
    process.exit(1);
  }
  let devices: DeviceConfig[];
  try {
    devices = z.array(DeviceSchema).parse(JSON.parse(parsed.data.DEVICES));
  } catch (e) {
    console.error('DEVICES must be a JSON array like [{"name":"..","serial":"..","ip":"..","port":4370}]', e);
    process.exit(1);
  }
  if (parsed.data.ADAPTER === 'pull' && devices.length === 0) {
    console.error('ADAPTER=pull needs at least one entry in DEVICES');
    process.exit(1);
  }
  return { ...parsed.data, devices };
}
