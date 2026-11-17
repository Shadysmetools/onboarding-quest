// Telegram webhook for the Mentor Bot.
//  /next /progress /done /help  - guidance + tick buttons
//  screenshot from the learner  - ticks the matching step, or asks which step it is for
//  "installed / done / finished" - offers the tick buttons
//  "watched #3 #4"               - ticks videos by number (learner only)
//  the "humans" topic            - the bot never replies there
import {
  ALLOWED, CHAT_ID, DASH_URL, LEARNER_ID, QUEST, TOPICS, addEvidence, announce, currentDay,
  getState, json, logEvent, matchStep, nextStep, progressText, redis, refreshPinned, setCheck,
  setVideo, stepByKey, stepDone, stepKeyboard, tg, touch, K,
} from "./_lib.mjs";

const helpText = () => [
  "🤖 Mentor Bot commands",
  "/next - your next step",
  "/progress - today's checklist",
  "/done - tick steps with buttons",
  "",
  "📸 Send a screenshot of your work and I'll attach it as evidence to a step.",
  ...(QUEST.videos.length ? ["🎬 Watched a video? Send \"watched #1 #2\" and I'll tick it."] : []),
  `Dashboard: ${DASH_URL}`,
].join("\n");

export async function POST(req) {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret || req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return json({ error: "forbidden" }, 403);
  }
  const u = await req.json();
  try {
    if (u.callback_query) await onCallback(u.callback_query);
    else if (u.message) await onMessage(u.message);
  } catch (e) {
    console.error(e);
  }
  return json({ ok: true });
}

const isLearner = from => !!LEARNER_ID && String(from?.id) === LEARNER_ID;

async function onMessage(m) {
  if (String(m.chat.id) !== String(CHAT_ID)) return;
  if (m.forum_topic_created || m.forum_topic_edited) return;
  const photo = m.photo?.at(-1)?.file_id ||
    (m.document?.mime_type?.startsWith("image/") ? m.document.file_id : null);
  const text = m.text || m.caption || "";

  if (!m.from?.is_bot && isLearner(m.from)) {
    await logEvent("learner (telegram)", photo ? "screenshot" : "message", text || "(no text)");
  }
  if (m.from?.is_bot || (TOPICS.humans && m.message_thread_id === TOPICS.humans)) return;

  const reply = (body, extra = {}) => tg("sendMessage", {
    chat_id: CHAT_ID, text: body,
    ...(m.is_topic_message ? { message_thread_id: m.message_thread_id } : {}),
    reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true },
    ...extra,
  });
  const allowed = ALLOWED.includes(String(m.from?.id));
  const cmd = text.startsWith("/") ? text.split(/[\s@]/)[0].toLowerCase() : null;
  const s = await getState();

  if (cmd === "/help" || cmd === "/start") return reply(helpText());
  if (cmd === "/progress") return reply(progressText(s));
  if (cmd === "/next") {
    const nx = nextStep(s);
    return reply(nx ? `👉 Next step (Day ${nx.day.n}): ${nx.step.t}` +
      (nx.step.quiz ? `\nTake the quiz on the dashboard: ${DASH_URL}` : "\nWhen it's done, tap /done or send a screenshot.")
      : `🏁 ${QUEST.finale}`);
  }
  if (cmd === "/done") {
    if (!allowed) return;
    return reply(`Tap a step to tick it (Day ${currentDay(s).n}):`, { reply_markup: stepKeyboard(s, "c") });
  }

  if (photo && allowed) {
    const hit = text && matchStep(s, text);
    if (hit) {
      await addEvidence(hit.k, { file_id: photo, caption: text, at: Date.now() });
      await setCheck(hit.k, true);
      await logEvent("bot (auto)", "ticked", `${hit.t} (from screenshot)`);
      await touch();
      const after = await getState();
      const nx = nextStep(after);
      await reply(`✅ Ticked: ${hit.t} (screenshot saved as evidence)` + (nx ? `\n👉 Next: ${nx.step.t}` : ""));
      await Promise.all([refreshPinned(after), announce(s, after)]);
      return;
    }
    const sent = await reply("📸 Evidence received! Which step is this for?",
      { reply_markup: stepKeyboard(s, "e", true) });
    if (sent) {
      await redis("SET", K(`pending:${sent.message_id}`),
        JSON.stringify({ file_id: photo, caption: text }), "EX", "604800");
    }
    return;
  }

  // "watched #3 #4" -> tick videos by number. Learner only, and only when the
  // message starts with the keyword, so a mentor mentioning "#8" never ticks anything.
  const vnums = isLearner(m.from) && /^\s*(watched|video|videos|vid)\b/i.test(text)
    ? [...new Set([...text.matchAll(/#?\b(\d{1,3})\b/g)].map(x => x[1]))].filter(n => QUEST.videoNums[n])
    : [];
  if (!cmd && vnums.length) {
    for (const n of vnums) await setVideo(QUEST.videoNums[n], true);
    await logEvent("learner (telegram)", "video", `watched #${vnums.join(", #")}`);
    await touch();
    return reply(`🎬 Marked as watched: #${vnums.join(", #")} (+10 XP each). It shows on the dashboard now.`);
  }

  // Quiz steps can't be ticked by hand: the score has to come from the dashboard.
  if (allowed && !cmd && /\b(quiz|exam)\b/i.test(text)) {
    const q = Object.entries(s.quiz).map(([id, sc]) => `${id}: ${sc}/${QUEST.quizCounts[id] ?? "?"}`).join(", ");
    return reply("🧠 Quizzes tick automatically when you finish them on the dashboard. " +
      "Open it from your personal link (the one with ?k=) or the score stays only in your browser.\n" +
      `Scores I can see: ${q || "none yet"}`);
  }
  if (allowed && !cmd && /\b(installed|done|finished|completed|created)\b/i.test(text)) {
    return reply("Nice! Tick it off so it shows on the dashboard:", { reply_markup: stepKeyboard(s, "c", true) });
  }
}

async function onCallback(q) {
  const answer = text => tg("answerCallbackQuery", { callback_query_id: q.id, text });
  if (!ALLOWED.includes(String(q.from.id))) return answer("Only the learner and mentors can tick steps.");
  const [kind, key] = (q.data || "").split(":");
  const step = stepByKey(key);
  if (!step) return answer("Unknown step");
  const before = await getState();
  let note;
  if (kind === "e") {
    const pending = JSON.parse(await redis("GET", K(`pending:${q.message.message_id}`)) || "null");
    if (pending) await addEvidence(key, { file_id: pending.file_id, caption: pending.caption, at: Date.now() });
    await setCheck(key, true);
    note = `✅ ${step.t} + screenshot saved`;
  } else {
    const on = !stepDone(before, step);
    await setCheck(key, on);
    note = `${on ? "✅" : "⬜"} ${step.t}`;
  }
  await logEvent(isLearner(q.from) ? "learner (telegram)" : "mentor (telegram)", "ticked", note.replace(/^\S+\s/, ""));
  await touch();
  const after = await getState();
  await answer(note.slice(0, 190));
  if (kind === "e") {
    await tg("editMessageText", { chat_id: CHAT_ID, message_id: q.message.message_id,
      text: `📸 Evidence saved for: ${step.t}` });
  } else {
    await tg("editMessageReplyMarkup", { chat_id: CHAT_ID,
      message_id: q.message.message_id, reply_markup: stepKeyboard(after, "c") });
  }
  await Promise.all([refreshPinned(after), announce(before, after)]);
}
