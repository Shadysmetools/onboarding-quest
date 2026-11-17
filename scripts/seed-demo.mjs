// Seeds the local store with sample progress for `npm run demo` and screenshots.
// Day 1 done, Day 2 half done, one quiz passed, a few videos watched.
import { QUEST, logEvent, redis, setCheck, setQuiz, setVideo, K } from "../api/_lib.mjs";

export async function seed() {
  const [d1, d2] = QUEST.days;
  for (const st of d1?.steps || []) if (!st.quiz) await setCheck(st.k, true);
  for (const st of (d2?.steps || []).slice(0, 2)) if (!st.quiz) await setCheck(st.k, true);
  for (const id of d1?.quizzes || []) await setQuiz(id, QUEST.quizCounts[id]);
  for (const id of d2?.quizzes || []) await setQuiz(id, Math.max(0, QUEST.quizCounts[id] - 2));
  for (const url of [...(d1?.videos || []), ...(d2?.videos || [])]) await setVideo(url, true);
  const day = new Date().toLocaleDateString("en-CA", { timeZone: process.env.TIMEZONE || "UTC" });
  await redis("HSET", K("meta"), "streak", "3", "lastDay", day, "updatedAt", String(Date.now()));
  await redis("HSET", K("minutes"), day, "42");
  await logEvent("learner (dashboard)", "ticked", d2?.steps[1]?.t || "a step");
  await logEvent("learner (telegram)", "screenshot", "ssh key added");
}
