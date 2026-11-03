# Device bridge

Runs on a PC / Raspberry Pi **inside the mess LAN**. Talks to the eSSL / ZKTeco machines (plain TCP/HTTP on the LAN) and forwards punches to Supabase over **HTTPS**, because the machines cannot speak HTTPS to the cloud themselves.

```
eSSL machine(s) ──LAN──▶ bridge ──HTTPS + x-device-secret──▶ Edge Function ingest-punches ──▶ ingest_punch() (SQL)
```

```bash
cp .env.example .env     # fill in INGEST_URL, DEVICE_INGEST_SECRET, DEVICES
npm install
npm run mock             # fake punches, no hardware
npm start                # real adapter (ADAPTER=pull | adms in .env)
npm test                 # queue / retry / parser tests
```

| Adapter | When | Notes |
|---|---|---|
| `mock` | demos, tests | generates normal punches, double-punches, strangers' PINs and exact re-sends |
| `pull` | machine allows TCP **4370** | polls each device every `POLL_INTERVAL_SECONDS` using `node-zklib`; remembers the last seen timestamp in `data/state.json`; first run backfills `PULL_BACKFILL_HOURS` (48) |
| `adms` | machine has a "Cloud Server / ADMS" setting | HTTP server on `ADMS_PORT` (8081); point the machine's server address/port at the bridge PC; replies `OK`; only accepts the IPs listed in `DEVICES` |

**Reliability:** punches are written to `data/queue.json` before sending; batches of 100; retries with exponential backoff; if the internet is down they wait on disk and are re-sent (safe — the database ignores repeats). A wrong secret (HTTP 401) keeps everything queued and logs `FATAL`. A permanently malformed batch is moved to `data/dead-letter.jsonl` so it can't block the queue.

**Privacy:** only `{device_serial, device_user_id, punched_at, verify_mode}` leave the building. The adapters never request or forward fingerprint/face templates.

Keep the device protocol details inside `src/adapters/*` — the rest of the bridge only knows the `DeviceAdapter` interface (`src/types.ts`).

## Hardware test checklist

Do these in order, with **one** staff member as the guinea pig. Tick each before moving on.

**A. Before touching the software**
- [ ] Machine has a **static IP** (or DHCP reservation) and the bridge PC can `ping` it.
- [ ] Machine clock is correct and set to IST (a wrong clock is the #1 cause of `outside_window`).
- [ ] Serial number noted exactly (Menu → System/Device Info) and added in the web app (Admin → Setup → Add machine).
- [ ] Decide mode: does the menu have **Comm / Ethernet → "Cloud Server Setting"** (ADMS push)? If yes try `adms`. Otherwise use `pull` (TCP 4370; check "Comm Key" is 0/blank, or extend `pull.ts` to pass it).

**B. Pull mode** (`ADAPTER=pull`)
- [ ] `DEVICES=[{"name":"…","serial":"<exact serial>","ip":"192.168.1.x","port":4370}]`
- [ ] `npm start` → log shows `[pull] <name> (<ip>): N records on device` (not "unreachable").
- [ ] If it can't connect: firewall on the PC, wrong port, or firmware without TCP — try ADMS.
- [ ] `// TODO: verify` in `adapters/pull.ts`: confirm the timestamp of a real punch lands in the web feed at the **same wall-clock time** as on the machine (adjust `DEVICE_UTC_OFFSET` if not).

**C. ADMS push mode** (`ADAPTER=adms`)
- [ ] On the machine set Server Address = bridge PC LAN IP, Port = `ADMS_PORT`, enable "proxy/domain" **off**.
- [ ] Run with `LOG_RAW=1 npm start` and watch for `GET /iclock/cdata?SN=…` (handshake). Seeing it = the machine reaches you.
- [ ] Punch once; log shows `received 1 punch(es)`. If lines are not parsed, compare the raw line to `parseAttLog()` in `adapters/adms.ts` and adjust field positions (`// TODO: verify`).

**D. End-to-end with one person**
- [ ] Manager → Students → enrol the staff member's PIN.
- [ ] They punch inside a meal window → Live feed shows **Matched**; Devices page shows the machine **Online**.
- [ ] They punch again → **Duplicate**, no second charge.
- [ ] A PIN nobody enrolled → **Unmatched**.
- [ ] Unplug the bridge PC's internet, punch twice, plug back in → both punches arrive (queue), still only one charge per meal.
- [ ] Reboot the bridge PC mid-queue → punches survive (`data/queue.json`).

**E. Then** enrol students in bulk, import fees, and switch the demo `MOCK-DEV-…` machines to disabled.

Run it as a service: `npm i -g pm2 && pm2 start "npm start" --name mess-bridge && pm2 save` (or NSSM on Windows).
