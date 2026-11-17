// Mirrors the quest into GitHub: labels, one milestone, one issue per day
// (steps as a checklist) and a Project board. Uses the gh CLI, logged in with
// the "project" scope (gh auth login && gh auth refresh -s project).
//   npm run tracker:github -- --owner <org-or-user> --repo <name>
//        [--private] [--assignee <gh-user>] [--start YYYY-MM-DD] [--dry-run]
// Safe to re-run: the repo, labels, milestone, issues and project are matched by name.
import { execFileSync } from "node:child_process";
import { dueDate, loadTasks, parseArgs, startDate, ymd } from "./lib.mjs";

const args = parseArgs();
const DRY = Boolean(args["dry-run"]);
if (!args.owner || !args.repo) {
  console.error("Usage: npm run tracker:github -- --owner <org-or-user> --repo <name> [--private] [--assignee <user>] [--start YYYY-MM-DD] [--dry-run]");
  process.exit(1);
}
const OWNER = args.owner, FULL = `${args.owner}/${args.repo}`;
const data = loadTasks(args.quest);
const start = startDate(args.start);
const PROJECT_TITLE = args.project || data.project;

function gh(argv, { allowFail = false, write = true } = {}) {
  if (DRY && write) {
    console.log(`  [dry-run] gh ${argv.map(a => (/\s/.test(a) ? JSON.stringify(a.length > 60 ? a.slice(0, 57) + "..." : a) : a)).join(" ")}`);
    return "";
  }
  try {
    return execFileSync("gh", argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (e) {
    if (allowFail) return null;
    throw new Error(`gh ${argv.slice(0, 3).join(" ")} failed: ${(e.stderr || e.message).toString().trim()}`);
  }
}

function main() {
  console.log(`${DRY ? "[DRY RUN] " : ""}GitHub setup for ${FULL}, Day 1 = ${ymd(start)}`);

  const exists = gh(["repo", "view", FULL, "--json", "name"], { allowFail: true, write: false });
  if (exists) console.log(`Repo ${FULL} exists, reusing.`);
  else gh(["repo", "create", FULL, args.private ? "--private" : "--public", "--add-readme", "--description", data.milestone]);

  const labels = [...new Set(data.tasks.flatMap(t => t.tags))];
  for (const name of labels) gh(["label", "create", name, "--repo", FULL, "--color", name.startsWith("day-") ? "bfdadc" : "1d76db", "--force"]);
  console.log(`${labels.length} labels ensured.`);

  const ms = DRY || !exists ? [] : JSON.parse(gh(["api", `repos/${FULL}/milestones?state=all&per_page=100`], { write: false }) || "[]");
  if (!ms.some(m => m.title === data.milestone)) {
    const due = dueDate(start, Math.max(...data.tasks.map(t => t.dueDay)));
    gh(["api", `repos/${FULL}/milestones`, "-f", `title=${data.milestone}`,
      "-f", `due_on=${due.toISOString().replace(/\.\d+Z$/, "Z")}`, "-f", "description=Onboarding quest"]);
  }

  const existing = DRY || !exists ? [] : JSON.parse(gh(["issue", "list", "--repo", FULL, "--state", "all", "--limit", "500", "--json", "title,url"], { write: false }) || "[]");
  const byTitle = new Map(existing.map(i => [i.title, i.url]));
  const urls = [];
  for (const t of data.tasks) {
    if (byTitle.has(t.title)) { urls.push(byTitle.get(t.title)); continue; }
    const body = [t.description, "### Checklist\n" + t.subtasks.map(s => `- [ ] ${s}`).join("\n"),
      `---\n**Due:** ${ymd(dueDate(start, t.dueDay))}`].filter(Boolean).join("\n\n");
    const argv = ["issue", "create", "--repo", FULL, "--title", t.title, "--body", body, "--milestone", data.milestone];
    for (const l of t.tags) argv.push("--label", l);
    if (args.assignee) argv.push("--assignee", args.assignee);
    const url = gh(argv);
    if (url) urls.push(url);
  }
  console.log(`${data.tasks.length} issues ensured (${byTitle.size} already existed).`);

  let project = null;
  if (!DRY) project = JSON.parse(gh(["project", "list", "--owner", OWNER, "--format", "json", "--limit", "100"], { write: false }))
    .projects.find(p => p.title === PROJECT_TITLE) || null;
  if (!project) {
    const out = gh(["project", "create", "--owner", OWNER, "--title", PROJECT_TITLE, "--format", "json"]);
    project = DRY ? { number: "<N>", url: "(dry-run)" } : JSON.parse(out);
  }
  gh(["project", "link", String(project.number), "--owner", OWNER, "--repo", FULL], { allowFail: true });
  const onBoard = new Set();
  if (!DRY) {
    const items = JSON.parse(gh(["project", "item-list", String(project.number), "--owner", OWNER, "--format", "json", "--limit", "1000"], { write: false }));
    for (const it of items.items || []) if (it.content?.url) onBoard.add(it.content.url);
  }
  for (const url of urls) if (!onBoard.has(url)) gh(["project", "item-add", String(project.number), "--owner", OWNER, "--url", url]);
  console.log(`\nDone.\nRepo:    https://github.com/${FULL}\nProject: ${project.url}`);
}

try { main(); } catch (e) { console.error(e.message); process.exit(1); }
