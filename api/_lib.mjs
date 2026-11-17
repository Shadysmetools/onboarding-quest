// Shared state, quest logic and Telegram helpers for the dashboard <-> bot sync.
// State is one Redis hash per field, so a dashboard write and a Telegram tap
// never overwrite each other.
import quest from "./_quest.json" with { type: "json" };
import { redis } from "./_store.mjs";

export { redis };
export const QUEST = quest;
const env = process.env;
const TOKEN = env.TELEGRAM_BOT_TOKEN;
export const telegramEnabled = !!(TOKEN && env.TELEGRAM_CHAT_ID);
const TG = `https://api.telegram.org/bot${TOKEN}`;
export const CHAT_ID = env.TELEGRAM_CHAT_ID;
export const TOPICS = JSON.parse(env.TELEGRAM_TOPICS || "{}");
export const LEARNER_ID = String(env.LEARNER_TELEGRAM_ID || "");
export const ALLOWED = [...new Set([LEARNER_ID, ...(env.TELEGRAM_ALLOWED_IDS || "").split(",")]
  .map(s => s.trim()).filter(Boolean))];
export const DASH_URL = (env.DASHBOARD_URL || "http://localhost:3000").replace(/\/$/, "");
export const TIMEZONE = env.TIMEZONE || "UTC";
const P = env.KEY_PREFIX || "oq:";
export const K = name => P + name;

/* ---------- auth ---------- */
// Learner link: ?k=PROGRESS_KEY. Mentor link: ?k=ADMIN_KEY. Anything else is view-only.
export function roleOf(req) {
  const k = new URL(req.url).searchParams.get("k");
  if (!k) return null;
  if (env.PROGRESS_KEY && k === env.PROGRESS_KEY) return "learner";
  if (env.ADMIN_KEY && k === env.ADMIN_KEY) return "mentor";
  return null;
}

/* ---------- state ---------- */
const hashObj = arr => {
  const o = {};
  for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1];
  return o;
};

export async function getState() {
  const [checks, videos, quiz, evidence, meta] = await Promise.all(
    ["checks", "videos", "quiz", "evidence", "meta"].map(n => redis("HGETALL", K(n))));
  const m = hashObj(meta);
  return {
    checks: Object.fromEntries(Object.keys(hashObj(checks)).map(k => [k, true])),
    videos: Object.fromEntries(Object.keys(hashObj(videos)).map(k => [k, true])),
    quiz: Object.fromEntries(Object.entries(hashObj(quiz)).map(([k, v]) => [k, Number(v)])),
    evidence: Object.fromEntries(Object.entries(hashObj(evidence)).map(([k, v]) => [k, JSON.parse(v)])),
    exam: Number(m.exam || 0),
    streak: Number(m.streak || 0),
    lastDay: m.lastDay || null,
    updatedAt: Number(m.updatedAt || 0),
  };
}

export const setCheck = (key, on) =>
  on ? redis("HSET", K("checks"), key, "1") : redis("HDEL", K("checks"), key);
export const setVideo = (url, on) =>
  on ? redis("HSET", K("videos"), url, "1") : redis("HDEL", K("videos"), url);
export async function setQuiz(id, score) {
  const cur = Number(await redis("HGET", K("quiz"), id) ?? -1);
  if (score > cur) await redis("HSET", K("quiz"), id, String(score));
}
export async function setExam(score) {
  const cur = Number(await redis("HGET", K("meta"), "exam") || 0);
  if (score > cur) await redis("HSET", K("meta"), "exam", String(score));
}
export async function addEvidence(key, item) {
  const cur = JSON.parse(await redis("HGET", K("evidence"), key) || "[]");
  cur.push(item);
  await redis("HSET", K("evidence"), key, JSON.stringify(cur.slice(-5)));
}
const dayKey = (t = Date.now()) => new Date(t).toLocaleDateString("en-CA", { timeZone: TIMEZONE });
export async function touch(meta = {}) {
  const t = dayKey();
  const last = await redis("HGET", K("meta"), "lastDay");
  if (last !== t) {
    const streak = last === dayKey(Date.now() - 864e5)
      ? Number(await redis("HGET", K("meta"), "streak") || 0) + 1 : 1;
    await redis("HSET", K("meta"), "lastDay", t, "streak", String(streak));
  }
  const kv = Object.entries({ ...meta, updatedAt: Date.now() }).flat().map(String);
  await redis("HSET", K("meta"), ...kv);
}

/* ---------- quest logic (single source of "next step") ---------- */
export const passed = (s, id) =>
  (s.quiz[id] ?? -1) / (QUEST.quizCounts[id] || 10) >= QUEST.passMark;
export const stepDone = (s, st) => st.quiz
  ? st.quiz.length > 0 && st.quiz.every(id => passed(s, id))
  : !!s.checks[st.k];
export const dayDone = (s, d) => d.steps.every(st => stepDone(s, st));
export function nextStep(s) {
  for (const d of QUEST.days) {
    const st = d.steps.find(x => !stepDone(s, x));
    if (st) return { day: d, step: st };
  }
  return null;
}
export const currentDay = s => QUEST.days.find(d => !dayDone(s, d)) || QUEST.days.at(-1);
export const stepByKey = k => QUEST.days.flatMap(d => d.steps).find(st => st.k === k);
export function summary(s) {
  return {
    days: QUEST.days.filter(d => dayDone(s, d)).length,
    quizzes: Object.keys(QUEST.quizCounts).filter(id => passed(s, id)).length,
    quizTotal: Object.keys(QUEST.quizCounts).length,
  };
}

/* ---------- telegram ---------- */
export async function tgRaw(method, params) {
  if (!TOKEN) return { ok: false, description: "telegram disabled" };
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const j = await r.json();
  if (!j.ok && !/not modified/.test(j.description || "")) console.error(method, j.description);
  return j;
}
export const tg = async (method, params) => (await tgRaw(method, params)).result;
const thread = name => (TOPICS[name] ? { message_thread_id: TOPICS[name] } : {});

export function progressText(s) {
  const sum = summary(s);
  const d = currentDay(s);
  const nx = nextStep(s);
  const ex = QUEST.exam;
  return [
    `📊 ${QUEST.learner}'s progress (live)`,
    `Days complete: ${sum.days}/${QUEST.days.length} · Quizzes passed: ${sum.quizzes}/${sum.quizTotal}` +
      (ex && s.exam ? ` · ${ex.name}: ${s.exam}/${ex.count}` : "") +
      ` · Streak: ${s.streak || 0} 🔥`,
    "",
    `Day ${d.n}: ${d.title}`,
    ...d.steps.map(st => `${stepDone(s, st) ? "✅" : "⬜"} ${st.t}`),
    "",
    nx ? `👉 Next: ${nx.step.t}` : `🏁 ${QUEST.finale}`,
    "",
    `Tap /done to tick steps here, or use ${DASH_URL}`,
    `Updated ${new Date().toLocaleString("en-GB", { timeZone: TIMEZONE })} (${TIMEZONE})`,
  ].join("\n");
}

// One pinned progress message in the updates topic, edited in place on every change.
export async function refreshPinned(s) {
  if (!telegramEnabled) return;
  const text = progressText(s);
  const id = await redis("GET", K("pinned"));
  if (id) {
    const j = await tgRaw("editMessageText", { chat_id: CHAT_ID, message_id: Number(id), text });
    if (j.ok || /not modified/.test(j.description || "")) return;
  }
  const m = await tg("sendMessage", { chat_id: CHAT_ID, ...thread("updates"), text, disable_notification: true });
  if (m) {
    await redis("SET", K("pinned"), String(m.message_id));
    await tg("pinChatMessage", { chat_id: CHAT_ID, message_id: m.message_id, disable_notification: true });
  }
}

// Celebrate milestones only (day done, quiz passed, exam passed): no spam.
export function milestones(before, after) {
  const msgs = [];
  for (const d of QUEST.days) {
    if (!dayDone(before, d) && dayDone(after, d)) msgs.push(`🎉 Day ${d.n} complete: ${d.title}!`);
  }
  for (const id of Object.keys(QUEST.quizCounts)) {
    if (!passed(before, id) && passed(after, id)) {
      msgs.push(`🏅 Passed the ${QUEST.quizzes[id].topic} quiz with ${after.quiz[id]}/${QUEST.quizCounts[id]}. Badge earned!`);
    }
  }
  const ex = QUEST.exam;
  if (ex && (before.exam || 0) < ex.pass && (after.exam || 0) >= ex.pass) {
    msgs.push(`🏆 ${ex.name} passed: ${after.exam}/${ex.count}!`);
  }
  return msgs;
}
export async function announce(before, after, extra = []) {
  const msgs = [...extra, ...milestones(before, after)];
  if (!msgs.length || !telegramEnabled) return msgs;
  const nx = nextStep(after);
  msgs.push(nx ? `👉 Next step: ${nx.step.t}` : `🏁 ${QUEST.finale}`);
  await tg("sendMessage", { chat_id: CHAT_ID, ...thread("updates"), text: msgs.join("\n") });
  return msgs;
}

// Match free text ("VS Code installed", "ssh key done") to exactly one open
// step of the current day, using each step's distinctive words.
const STOP = new Set(["install", "installed", "create", "your", "with", "and", "the", "add",
  "to", "a", "on", "of", "own", "it", "in", "done", "step", "today's", "pass", "or", "better",
  "doc", "part", "from", "use", "one", "an", "my", "i", "is", "for"]);
const words = t => t.toLowerCase().replace(/[^a-z0-9.+ ]/g, " ").split(/\s+/)
  .filter(w => w.length >= 2 && !STOP.has(w));
export function matchStep(s, text) {
  const said = new Set(words(text));
  const scored = currentDay(s).steps.filter(st => !st.quiz)
    .map(st => ({ st, n: words(st.t).filter(w => said.has(w)).length }))
    .filter(x => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length || (scored[1] && scored[1].n === scored[0].n)) return null;
  return scored[0].st;
}

export function stepKeyboard(s, prefix, onlyOpen = false) {
  const rows = currentDay(s).steps
    .filter(st => !st.quiz && (!onlyOpen || !stepDone(s, st)))
    .map(st => [{ text: `${stepDone(s, st) ? "✅" : "⬜"} ${st.t}`.slice(0, 60),
      callback_data: `${prefix}:${st.k}` }]);
  return { inline_keyboard: rows };
}

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status,
    headers: { "content-type": "application/json", "cache-control": "no-store" } });

/* ---------- activity log (who did what, when) ---------- */
export async function logEvent(who, type, detail = "") {
  const at = Date.now();
  await redis("LPUSH", K("log"), JSON.stringify({ at, who, type, detail: String(detail).slice(0, 200) }));
  await redis("LTRIM", K("log"), "0", "1999");
  if (who.startsWith("learner")) {
    await redis("HSET", K("seen"), "last", String(at),
      "lastWhat", `${type}${detail ? ": " + String(detail).slice(0, 80) : ""}`);
  }
}
export async function ping() {
  await redis("HINCRBY", K("minutes"), dayKey(), "1");
  await redis("HSET", K("seen"), "last", String(Date.now()));
}
export async function getActivity(limit = 300) {
  const [log, seen, minutes] = await Promise.all([
    redis("LRANGE", K("log"), "0", String(limit - 1)),
    redis("HGETALL", K("seen")), redis("HGETALL", K("minutes"))]);
  return {
    timezone: TIMEZONE,
    log: (log || []).map(x => JSON.parse(x)),
    seen: hashObj(seen),
    minutes: Object.fromEntries(Object.entries(hashObj(minutes)).map(([d, m]) => [d, Number(m)])),
  };
}
