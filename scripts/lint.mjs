// npm run lint: syntax-check every module, validate the quest files, and make
// sure the committed build output matches the quest file. No dependencies.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileQuest } from "../lib/compile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const fail = msg => { console.error("✗ " + msg); failed++; };

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".data"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.m?js$/.test(e.name)) files.push(p);
  }
})(root);
for (const f of files) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { fail(`${f}\n${e.stderr}`); }
}
console.log(`syntax: ${files.length} files checked`);

// The inline <script> in the page too.
const html = readFileSync(join(root, "public", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || "";
try { new Function(script); } catch (e) { fail(`public/index.html script: ${e.message}`); }

for (const name of ["quests.example.json", "quests.json"]) {
  if (!existsSync(join(root, name))) continue;
  try { compileQuest(JSON.parse(readFileSync(join(root, name), "utf8"))); console.log(`quest: ${name} is valid`); }
  catch (e) { fail(`${name}: ${e.message}`); }
}

const src = existsSync(join(root, "quests.json")) ? "quests.json" : "quests.example.json";
const want = JSON.stringify(compileQuest(JSON.parse(readFileSync(join(root, src), "utf8"))));
const built = JSON.stringify(JSON.parse(readFileSync(join(root, "api", "_quest.json"), "utf8")));
if (want !== built) fail(`api/_quest.json is out of date with ${src}: run npm run build`);
const inline = html.match(/\/\*DATA\*\/([\s\S]*?)\/\*END\*\//)?.[1];
if (!inline || JSON.stringify(JSON.parse(inline)) !== want) fail(`public/index.html data is out of date with ${src}: run npm run build`);

if (failed) { console.error(`${failed} problem(s)`); process.exit(1); }
console.log("lint: ok");
