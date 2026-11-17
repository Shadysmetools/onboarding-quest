// GET /api/file?k=KEY&id=<telegram file_id> -> streams a screenshot the bot
// received, so the dashboard can show evidence without storing any files.
import { json, roleOf } from "./_lib.mjs";

export async function GET(req) {
  if (!roleOf(req)) return json({ error: "unauthorized" }, 401);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ error: "telegram not configured" }, 404);
  const id = new URL(req.url).searchParams.get("id") || "";
  const base = `https://api.telegram.org/bot${token}`;
  const r = await (await fetch(`${base}/getFile?file_id=${encodeURIComponent(id)}`)).json();
  if (!r.ok) return json({ error: "not found" }, 404);
  const f = await fetch(`https://api.telegram.org/file/bot${token}/${r.result.file_path}`);
  return new Response(f.body, { headers: {
    "content-type": f.headers.get("content-type") || "image/jpeg",
    "cache-control": "private, max-age=86400",
  } });
}
