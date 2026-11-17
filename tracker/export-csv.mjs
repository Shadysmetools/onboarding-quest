// Writes tracker/tasks.csv: one row per day plus one row per step (Parent Task
// set), ready for CSV import into ClickUp, Jira, Linear, Asana or a spreadsheet.
//   npm run tracker:csv -- [--start YYYY-MM-DD]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dueDate, loadTasks, parseArgs, startDate, ymd } from "./lib.mjs";

const args = parseArgs();
const data = loadTasks(args.quest);
const start = startDate(args.start);
const esc = v => `"${String(v).replace(/"/g, '""')}"`;
const rows = [["Task Name", "Description", "List", "Due Date", "Tags", "Parent Task"]];
for (const t of data.tasks) {
  const due = ymd(dueDate(start, t.dueDay));
  rows.push([t.title, t.description, data.milestone, due, t.tags.join(","), ""]);
  for (const s of t.subtasks) rows.push([s, "", data.milestone, due, t.tags.join(","), t.title]);
}
const out = join(dirname(fileURLToPath(import.meta.url)), "tasks.csv");
writeFileSync(out, "﻿" + rows.map(r => r.map(esc).join(",")).join("\r\n") + "\r\n");
console.log(`tasks.csv written: ${rows.length - 1} rows (Day 1 = ${ymd(start)})`);
