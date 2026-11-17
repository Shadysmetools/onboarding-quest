// Turns a quest file (quests.json / quests.example.json) into the compiled
// shape the dashboard and the API share. Throws on anything inconsistent, so
// a broken quest file fails `npm run build` instead of failing at runtime.

export function compileQuest(src) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(typeof src.title === "string" && src.title, "title is required");
  need(Array.isArray(src.days) && src.days.length, "days[] is required");
  const quizzes = src.quizzes || {};
  const passMark = Number(src.passMark ?? 0.8);
  need(passMark > 0 && passMark <= 1, "passMark must be between 0 and 1");

  for (const [id, q] of Object.entries(quizzes)) {
    need(Array.isArray(q.questions) && q.questions.length, `quiz ${id}: questions[] is required`);
    (q.questions || []).forEach((x, i) => {
      need(typeof x.q === "string" && x.q, `quiz ${id} #${i + 1}: q is required`);
      need(Array.isArray(x.options) && x.options.length >= 2, `quiz ${id} #${i + 1}: needs 2+ options`);
      need(Number.isInteger(x.answer) && x.answer >= 0 && x.answer < (x.options || []).length,
        `quiz ${id} #${i + 1}: answer must index into options`);
    });
  }

  // Videos get a global number so "watched #3" works in Telegram.
  const videos = (src.videos || []).map((v, i) => ({ n: i + 1, lang: "EN", ...v }));
  const videoById = Object.fromEntries(videos.map(v => [v.id, v]));
  videos.forEach(v => need(/^https?:\/\//.test(v.url || ""), `video ${v.id || v.n}: url is required`));

  const pct = Math.round(passMark * 100);
  const days = (src.days || []).map((d, idx) => {
    const n = d.n ?? idx + 1;
    const dq = d.quizzes || [];
    dq.forEach(id => need(quizzes[id], `day ${n}: unknown quiz "${id}"`));
    (d.videos || []).forEach(id => need(videoById[id], `day ${n}: unknown video "${id}"`));
    const steps = (d.steps || []).map((s, i) => ({ k: `s${n}-${i + 1}`, t: typeof s === "string" ? s : s.t }));
    if (dq.length) {
      steps.push({ k: `s${n}-${steps.length + 1}`,
        t: `Pass today's quiz${dq.length > 1 ? "zes" : ""} with ${pct}% or better`, quiz: dq });
    }
    need(steps.length, `day ${n}: needs at least one step or quiz`);
    return { n, title: d.title || `Day ${n}`, summary: d.summary || "", docs: d.docs || [],
      quizzes: dq, videos: (d.videos || []).map(id => videoById[id]?.url).filter(Boolean), steps };
  });

  const tracks = (src.tracks || []).map(t => {
    (t.quizzes || []).forEach(id => need(quizzes[id], `track ${t.key}: unknown quiz "${id}"`));
    return { key: t.key, name: t.name, short: t.short || t.key.slice(0, 4).toUpperCase(),
      quizzes: t.quizzes || [], docs: t.docs || [] };
  });

  const total = Object.values(quizzes).reduce((n, q) => n + (q.questions || []).length, 0);
  const exam = src.exam === false || !total ? null : {
    name: src.exam?.name || "Final exam",
    count: Math.min(src.exam?.count || 30, total),
  };
  if (exam) exam.pass = Math.min(src.exam?.pass ?? Math.ceil(exam.count * passMark), exam.count);

  if (errors.length) {
    const e = new Error("Invalid quest file:\n  - " + errors.join("\n  - "));
    e.errors = errors;
    throw e;
  }

  return {
    title: src.title,
    learner: src.learner || "Learner",
    tagline: src.tagline || "",
    passMark,
    levels: src.levels?.length ? src.levels : [{ at: 0, name: "Rookie" }],
    exam,
    finale: src.finale || "All done!",
    days,
    videos,
    tracks,
    resources: src.resources || [],
    quizzes,
    quizCounts: Object.fromEntries(Object.entries(quizzes).map(([id, q]) => [id, q.questions.length])),
    videoNums: Object.fromEntries(videos.map(v => [String(v.n), v.url])),
  };
}
