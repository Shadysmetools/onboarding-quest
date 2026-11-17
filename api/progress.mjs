// GET  /api/progress?k=KEY            -> shared state (reading is public)
// POST /api/progress?k=KEY  {op,...}  -> apply one change, return state
//   ops: check{key,value} video{url,value} quiz{id,score} exam{score}
//        merge{state}  (first sync of a browser's local progress)
//        event{type,detail} ping   (activity only)
import {
  announce, getState, json, logEvent, ping, refreshPinned, roleOf, setCheck,
  setExam, setQuiz, setVideo, stepByKey, touch,
} from "./_lib.mjs";

const LABEL = { check: "ticked", video: "video", quiz: "quiz score", exam: "final exam" };

export async function GET(req) {
  const role = roleOf(req);
  return json({ ...(await getState()), canEdit: !!role, role });
}

export async function POST(req) {
  const role = roleOf(req);
  if (!role) return json({ error: "unauthorized" }, 401);
  const b = await req.json().catch(() => ({}));
  const who = `${role} (dashboard)`;

  if (b.op === "event") {
    await logEvent(who, String(b.type || "event").slice(0, 40), b.detail || "");
    return json({ ok: true });
  }
  if (b.op === "ping") {
    if (role === "learner") await ping();
    return json({ ok: true });
  }

  const before = await getState();
  switch (b.op) {
    case "check": await setCheck(String(b.key), !!b.value); break;
    case "video": await setVideo(String(b.url), !!b.value); break;
    case "quiz": await setQuiz(String(b.id), Number(b.score) || 0); break;
    case "exam": await setExam(Number(b.score) || 0); break;
    case "merge": {
      // union of checks/videos, max of quiz/exam: never lose progress
      const s = b.state || {};
      for (const [k, v] of Object.entries(s.checks || {})) if (v) await setCheck(k, true);
      for (const [u, v] of Object.entries(s.videos || {})) if (v) await setVideo(u, true);
      for (const [id, sc] of Object.entries(s.quiz || {})) await setQuiz(id, Number(sc) || 0);
      if (s.exam) await setExam(Number(s.exam));
      break;
    }
    default: return json({ error: "unknown op" }, 400);
  }
  if (b.op !== "merge") {
    const step = b.key ? (stepByKey(b.key)?.t || b.key) : "";
    const what = b.op === "check" ? `${b.value ? "ticked" : "unticked"} ${step}`
      : b.op === "video" ? `${b.value ? "watched" : "unwatched"} ${b.url}`
      : b.op === "quiz" ? `quiz ${b.id}: best ${b.score}` : `final exam best ${b.score}`;
    await logEvent(who, LABEL[b.op], what);
  }
  await touch();
  const after = await getState();
  await Promise.all([refreshPinned(after), announce(before, after)]);
  return json({ ...after, canEdit: true, role });
}
