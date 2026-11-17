// Shared helpers for the tracker scripts: turn the quest file into one task
// per day (with the day's steps as a checklist) plus dates and arg parsing.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileQuest } from "../lib/compile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadTasks(file) {
  const name = file || (existsSync(join(root, "quests.json")) ? "quests.json" : "quests.example.json");
  const q = compileQuest(JSON.parse(readFileSync(join(root, name), "utf8")));
  return {
    project: q.title,
    milestone: `${q.title}: ${q.days.length}-day onboarding`,
    tasks: q.days.map(d => ({
      title: `Day ${d.n}: ${d.title}`,
      description: [d.summary,
        d.docs.length ? "**Read:**\n" + d.docs.map(x => `- [${x.title}](${x.url})`).join("\n") : "",
        d.quizzes.length ? `**Quiz:** ${d.quizzes.map(id => q.quizzes[id].topic).join(", ")} (on the dashboard)` : "",
      ].filter(Boolean).join("\n\n"),
      subtasks: d.steps.map(s => s.t),
      dueDay: d.n,
      tags: ["onboarding", `day-${d.n}`],
    })),
  };
}

// Minimal --flag value / --switch parser.
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[a.slice(2)] = true;
    else { out[a.slice(2)] = next; i++; }
  }
  return out;
}

// Start date: --start YYYY-MM-DD, else next Monday. Day N is due N-1 working days later.
export function startDate(arg) {
  if (arg) {
    const d = new Date(`${arg}T09:00:00`);
    if (Number.isNaN(d.getTime())) throw new Error(`Bad --start date: ${arg}`);
    return d;
  }
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return d;
}
export function dueDate(start, dueDay) {
  const d = new Date(start);
  let left = dueDay - 1;
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() % 6 !== 0) left--; }
  d.setHours(17, 0, 0, 0);
  return d;
}
export const ymd = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
