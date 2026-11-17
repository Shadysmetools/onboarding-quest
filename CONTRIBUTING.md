# Contributing

Thanks for helping make onboarding less painful. Issues and pull requests are welcome.

## Dev setup

```bash
git clone https://github.com/Shadysmetools/onboarding-quest.git
cd onboarding-quest
npm run demo        # sample data, no setup needed: http://localhost:3000/?k=demo-learner
```

Node.js 20.12 or newer. There are no runtime dependencies, and we'd like to keep it that way:
no frameworks, no bundler, just Node built-ins plus the browser.

## Before you open a PR

```bash
npm run build   # regenerates api/_quest.json and the data inside public/index.html
npm run lint    # syntax check + quest validation + build-output drift check
npm test        # node:test, runs against the in-memory store
```

CI runs the same three commands on Node 20, 22 and 24.

## Where things live

| Path | What it is |
|---|---|
| `quests.example.json` | The sample quest. Copy it to `quests.json` to make your own. |
| `lib/compile.mjs` | Validates a quest file and compiles it for the page and the API. |
| `public/index.html` | The whole dashboard: HTML, CSS and JS in one file. |
| `api/*.mjs` | Vercel functions. Files starting with `_` are shared modules, not routes. |
| `api/_store.mjs` | Upstash Redis REST client, with a local fallback store for dev. |
| `server.mjs` | Local dev server that runs the same `api/` handlers. |
| `scripts/` | Build, lint, demo seeding and Telegram webhook helpers. |
| `tracker/` | Optional: mirror the quest into GitHub Issues or a CSV. |

## Guidelines

- Keep the quest file the single source of truth. Don't hardcode day counts, names or scores.
- Never commit secrets, real learner data or screenshots that show real people's progress.
- New behaviour gets a test in `test/`.
- Keep PRs small and focused. Describe the "why" in the PR body.

By contributing you agree your contribution is licensed under the Apache License 2.0.
