// npm run telegram:webhook -- on|off|info|whoami
//   on     : point the bot at DASHBOARD_URL/api/telegram and set its command menu
//   off    : remove the webhook
//   info   : show the current webhook status (default)
//   whoami : list recent chats/users the bot has seen, to find TELEGRAM_CHAT_ID
//            and user ids (run it while the webhook is off)
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const { TELEGRAM_BOT_TOKEN: TOKEN, DASHBOARD_URL, WEBHOOK_SECRET } = process.env;
if (!TOKEN) { console.error("Set TELEGRAM_BOT_TOKEN in .env first."); process.exit(1); }

const call = async (method, body) => (await (await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}),
})).json());

const mode = process.argv[2] || "info";
if (mode === "on") {
  if (!/^https:\/\//.test(DASHBOARD_URL || "")) { console.error("DASHBOARD_URL must be your public https deployment URL."); process.exit(1); }
  if (!WEBHOOK_SECRET) { console.error("Set WEBHOOK_SECRET (same value as on your deployment)."); process.exit(1); }
  const url = `${DASHBOARD_URL.replace(/\/$/, "")}/api/telegram`;
  console.log("setWebhook", (await call("setWebhook", {
    url, secret_token: WEBHOOK_SECRET, allowed_updates: ["message", "callback_query"],
  })).ok, url);
  console.log("setMyCommands", (await call("setMyCommands", { commands: [
    { command: "next", description: "Your next step" },
    { command: "progress", description: "Today's checklist" },
    { command: "done", description: "Tick steps with buttons" },
    { command: "help", description: "What I can do" },
  ] })).ok);
} else if (mode === "off") {
  console.log("deleteWebhook", (await call("deleteWebhook")).ok);
} else if (mode === "whoami") {
  const r = await call("getUpdates", { limit: 100 });
  if (!r.ok) { console.error(r.description, "(turn the webhook off first: npm run telegram:webhook -- off)"); process.exit(1); }
  const seen = new Map();
  for (const u of r.result) {
    const m = u.message || u.callback_query?.message;
    const from = u.message?.from || u.callback_query?.from;
    if (m?.chat) seen.set(`chat ${m.chat.id}`, `${m.chat.type} "${m.chat.title || m.chat.first_name || ""}"`);
    if (from) seen.set(`user ${from.id}`, `${from.first_name || ""} ${from.username ? "@" + from.username : ""}`.trim());
    if (m?.message_thread_id) seen.set(`topic ${m.message_thread_id}`, `in chat ${m.chat.id}`);
  }
  if (!seen.size) console.log("No updates yet. Send a message in the group (mention the bot), then run this again.");
  for (const [k, v] of seen) console.log(k.padEnd(24), v);
}
const i = (await call("getWebhookInfo")).result || {};
console.log(`webhook=${i.url || "(none)"} pending=${i.pending_update_count ?? "?"} last_error=${i.last_error_message || "none"}`);
