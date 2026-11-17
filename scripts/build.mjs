// npm run build
// Reads quests.json (or quests.example.json if you have not made your own),
// validates it, writes api/_quest.json for the API and inlines the same data
// into public/index.html between the /*DATA*/ ... /*END*/ markers.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileQuest } from "../lib/compile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.env.QUEST_FILE ||
  (existsSync(join(root, "quests.json")) ? "quests.json" : "quests.example.json");

let quest;
try {
  quest = compileQuest(JSON.parse(readFileSync(join(root, file), "utf8")));
} catch (e) {
  console.error(`${file}: ${e.message}`);
  process.exit(1);
}

writeFileSync(join(root, "api", "_quest.json"), JSON.stringify(quest, null, 1) + "\n");

const page = join(root, "public", "index.html");
const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const blob = JSON.stringify(quest).replace(/<\//g, "<\\/");
const html = readFileSync(page, "utf8")
  .replace(/\/\*DATA\*\/[\s\S]*?\/\*END\*\//, () => `/*DATA*/${blob}/*END*/`)
  .replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(quest.title)}</title>`);
writeFileSync(page, html);

console.log(`Built from ${file}: ${quest.days.length} days, ` +
  `${quest.days.reduce((n, d) => n + d.steps.length, 0)} steps, ` +
  `${Object.keys(quest.quizzes).length} quizzes, ${quest.videos.length} videos.`);
