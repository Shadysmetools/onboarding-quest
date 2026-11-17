// Storage: Upstash Redis over REST when configured, otherwise a tiny local
// store (in memory, persisted to .data/store.json) so `npm run dev` works
// with zero setup. Only the handful of Redis commands the app uses exist here.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = process.env;
const URL_ = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
const TOKEN = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
export const storeKind = URL_ ? "upstash" : "local";

async function upstash(cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) throw new Error(`redis ${cmd[0]}: ${j.error}`);
  return j.result;
}

/* ---------- local fallback ---------- */
const FILE = env.LOCAL_STORE_FILE || join(process.cwd(), ".data", "store.json");
let mem = null;
function load() {
  if (mem) return mem;
  mem = new Map();
  if (env.LOCAL_STORE_FILE !== "memory" && existsSync(FILE)) {
    try { for (const [k, v] of Object.entries(JSON.parse(readFileSync(FILE, "utf8")))) mem.set(k, v); } catch {}
  }
  return mem;
}
function save() {
  if (env.LOCAL_STORE_FILE === "memory") return;
  try {
    mkdirSync(join(FILE, ".."), { recursive: true });
    writeFileSync(FILE, JSON.stringify(Object.fromEntries(mem)));
  } catch { /* read-only filesystem: keep it in memory */ }
}
const hash = (m, k) => { if (!m.has(k)) m.set(k, {}); return m.get(k); };
const list = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
const idx = (i, len) => (i < 0 ? len + i : i);

function local([c, k, ...a]) {
  const m = load();
  switch (c.toUpperCase()) {
    case "GET": return m.get(k) ?? null;
    case "SET": m.set(k, String(a[0])); save(); return "OK";
    case "DEL": m.delete(k); save(); return 1;
    case "HGET": return m.get(k)?.[a[0]] ?? null;
    case "HGETALL": return Object.entries(m.get(k) || {}).flat();
    case "HSET": { const h = hash(m, k); for (let i = 0; i < a.length; i += 2) h[a[i]] = String(a[i + 1]); save(); return a.length / 2; }
    case "HDEL": { const h = hash(m, k); for (const f of a) delete h[f]; save(); return a.length; }
    case "HINCRBY": { const h = hash(m, k); h[a[0]] = String(Number(h[a[0]] || 0) + Number(a[1])); save(); return Number(h[a[0]]); }
    case "LPUSH": { const l = list(m, k); l.unshift(...a.map(String).reverse()); save(); return l.length; }
    case "LRANGE": { const l = m.get(k) || []; return l.slice(idx(Number(a[0]), l.length), idx(Number(a[1]), l.length) + 1); }
    case "LTRIM": { const l = m.get(k) || []; m.set(k, l.slice(idx(Number(a[0]), l.length), idx(Number(a[1]), l.length) + 1)); save(); return "OK"; }
    default: throw new Error(`local store: unsupported command ${c}`);
  }
}

export async function redis(...cmd) {
  return URL_ ? upstash(cmd) : local(cmd);
}

// Tests use this to start from a clean slate.
export function resetLocalStore() { mem = new Map(); }
