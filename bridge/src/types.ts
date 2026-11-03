/** One attendance record as the cloud expects it. Contains NO biometric data. */
export interface RawPunch {
  device_serial: string;
  device_user_id: string;
  /** ISO 8601 with offset, e.g. 2025-01-31T12:30:05+05:30 */
  punched_at: string;
  verify_mode?: number | null;
  raw?: Record<string, unknown>;
}

/**
 * Pluggable source of punches. Everything device-protocol specific lives behind this interface,
 * so the rest of the bridge (batching, retry, offline queue) never changes.
 */
export interface DeviceAdapter {
  readonly name: string;
  /** Start background work (sockets, servers). Optional. */
  start?(): Promise<void>;
  /** Return punches seen since the previous call (the adapter remembers its own cursor). */
  fetchNewPunches(): Promise<RawPunch[]>;
  stop?(): Promise<void>;
  /** Serials of machines reachable since the last call (used for the online/offline indicator). Optional. */
  drainHeartbeats?(): string[];
}

export interface DeviceConfig {
  name: string;
  serial: string;
  ip: string;
  port: number;
}
