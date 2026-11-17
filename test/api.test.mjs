import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Local in-memory store, no Telegram, known keys. Must be set before importing the API.
for (const k of ["KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "TELEGRAM_BOT_TOKEN"]) delete process.env[k];
Object.assign(process.env, { LOCAL_STORE_FILE: "memory", PROGRESS_KEY: "learner-key", ADMIN_KEY: "mentor-key",
  WEBHOOK_SECRET: "hook", TELEGRAM_CHAT_ID: "-1", LEARNER_TELEGRAM_ID: "42" });

const { resetLocalStore } = await import("../api/_store.mjs");
const lib = await import("../api/_lib.mjs");
const progress = await import("../api/progress.mjs");
const activity = await import("../api/activity.mjs");
const telegram = await import("../api/telegram.mjs");
const { QUEST } = lib;

const req = (path, init) => new Request(`http://localhost${path}`, init);
const post = (k, body) => progress.POST(req(`/api/progress?k=${k}`, { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => resetLocalStore());

test("reading is public, writing needs a key", async () => {
  const r = await (await progress.GET(req("/api/progress"))).json();
  assert.equal(r.canEdit, false);
  assert.equal((await post("wrong", { op: "check", key: "s1-1", value: true })).status, 401);
});

test("learner ticks a step and it shows up for everyone", async () => {
  const r = await post("learner-key", { op: "check", key: "s1-1", value: true });
  assert.equal(r.status, 200);
  const s = await (await progress.GET(req("/api/progress"))).json();
  assert.equal(s.checks["s1-1"], true);
  assert.equal(s.streak, 1);
});

test("quiz scores only ever go up", async () => {
  await post("learner-key", { op: "quiz", id: "git", score: 4 });
  await post("learner-key", { op: "quiz", id: "git", score: 2 });
  const s = await lib.getState();
  assert.equal(s.quiz.git, 4);
});

test("nextStep walks the quest and quiz steps need a passing score", async () => {
  const d1 = QUEST.days[0];
  for (const st of d1.steps) if (!st.quiz) await lib.setCheck(st.k, true);
  let s = await lib.getState();
  assert.ok(lib.nextStep(s).step.quiz, "next step is the day 1 quiz");
  for (const id of d1.quizzes) await lib.setQuiz(id, QUEST.quizCounts[id]);
  s = await lib.getState();
  assert.equal(lib.nextStep(s).day.n, 2);
  assert.equal(lib.summary(s).days, 1);
});

test("milestones announce day completion and passed quizzes", async () => {
  const before = await lib.getState();
  for (const st of QUEST.days[0].steps) if (!st.quiz) await lib.setCheck(st.k, true);
  for (const id of QUEST.days[0].quizzes) await lib.setQuiz(id, QUEST.quizCounts[id]);
  const msgs = lib.milestones(before, await lib.getState());
  assert.ok(msgs.some(m => m.includes("Day 1 complete")));
  assert.ok(msgs.some(m => m.includes("Badge earned")));
});

test("matchStep picks exactly one step from free text", async () => {
  const s = await lib.getState();
  assert.equal(lib.matchStep(s, "VS Code installed!")?.t, "Install VS Code");
  assert.equal(lib.matchStep(s, "lunch break soon"), null);
});

test("merge never loses progress", async () => {
  await post("learner-key", { op: "quiz", id: "git", score: 5 });
  await post("learner-key", { op: "merge", state: { checks: { "s1-2": true }, quiz: { git: 1, ci: 3 } } });
  const s = await lib.getState();
  assert.equal(s.quiz.git, 5);
  assert.equal(s.quiz.ci, 3);
  assert.equal(s.checks["s1-2"], true);
});

test("activity log is mentor only", async () => {
  await post("learner-key", { op: "event", type: "opened tab", detail: "quest" });
  assert.equal((await activity.GET(req("/api/activity?k=learner-key"))).status, 401);
  const a = await (await activity.GET(req("/api/activity?k=mentor-key"))).json();
  assert.equal(a.log[0].who, "learner (dashboard)");
});

test("telegram webhook rejects calls without the secret", async () => {
  const r = await telegram.POST(req("/api/telegram", { method: "POST", body: "{}" }));
  assert.equal(r.status, 403);
});

test("telegram 'watched #N' ticks a video for the learner only", async () => {
  const send = (from, text) => telegram.POST(req("/api/telegram", { method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "hook" },
    body: JSON.stringify({ message: { message_id: 1, chat: { id: -1 }, from: { id: from }, text } }) }));
  await send(7, "watched #1");
  assert.equal(Object.keys((await lib.getState()).videos).length, 0);
  await send(42, "watched #1");
  assert.equal((await lib.getState()).videos[QUEST.videoNums["1"]], true);
});
