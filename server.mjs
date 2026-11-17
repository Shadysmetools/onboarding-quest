// Local dev server: serves public/ and routes /api/<name> to api/<name>.mjs,
// the same handlers Vercel runs. No dependencies.
//   npm run dev          -> uses .env if present
//   npm run demo         -> in-memory store seeded with sample progress
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const demo = process.argv.includes("--demo");
if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
if (demo) {
  // Demo never touches Upstash, Telegram or your real progress file.
  for (const k of ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "TELEGRAM_BOT_TOKEN"]) delete process.env[k];
  process.env.LOCAL_STORE_FILE = "memory";
  process.env.PROGRESS_KEY ||= "demo-learner";
  process.env.ADMIN_KEY ||= "demo-mentor";
}

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = join(root, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".pdf": "application/pdf", ".mp4": "video/mp4" };

const { storeKind } = await import("./api/_store.mjs");
if (demo) await (await import("./scripts/seed-demo.mjs")).seed();

async function api(req, res, name) {
  const file = join(root, "api", `${name}.mjs`);
  if (!/^[a-z0-9-]+$/.test(name) || !existsSync(file)) return send(res, 404, "not found");
  const mod = await import(pathToFileURL(file).href);
  const handler = mod[req.method];
  if (!handler) return send(res, 405, "method not allowed");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
  });
  const r = await handler(request);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}

function send(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(text);
}

createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const m = path.match(/^\/api\/([^/]+)\/?$/);
    if (m) return await api(req, res, m[1]);
    let file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
    if (!file.startsWith(PUBLIC)) return send(res, 403, "forbidden");
    if (!existsSync(file)) return send(res, 404, "not found");
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch (e) {
    console.error(e);
    send(res, 500, "server error");
  }
}).listen(PORT, () => {
  const base = `http://localhost:${PORT}`;
  console.log(`Onboarding Quest running at ${base}  (store: ${demo ? "demo, in memory" : storeKind})`);
  if (process.env.PROGRESS_KEY) console.log(`  Learner link: ${base}/?k=${process.env.PROGRESS_KEY}`);
  if (process.env.ADMIN_KEY) console.log(`  Mentor link:  ${base}/?k=${process.env.ADMIN_KEY}#mentor`);
  if (!process.env.PROGRESS_KEY) console.log("  No PROGRESS_KEY set: copy .env.example to .env to enable saving.");
});
