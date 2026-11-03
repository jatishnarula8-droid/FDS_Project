// node-zklib ships no types. Minimal surface we use.
declare module 'node-zklib' {
  export default class ZKLib {
    constructor(ip: string, port: number, timeoutMs: number, inportMs: number);
    createSocket(): Promise<void>;
    getInfo(): Promise<unknown>;
    getAttendances(): Promise<{ data: { userSn: number; deviceUserId: string; recordTime: Date; ip?: string }[] }>;
    disconnect(): Promise<void>;
  }
}
