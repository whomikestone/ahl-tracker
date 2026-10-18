# AHL standings tracker

A small site for following the AHL playoff race: standings by division, conference,
and league, plus playoff odds and weekly trends. It runs on Cloudflare Workers and is
live at https://ahl.mstone.io. Pushes to `main` deploy automatically, so anything
merged to `main` goes straight to the live site.

- `src/worker.js` fetches the AHL stats feed nightly (3 a.m. Pacific), stores a compact
  copy in KV, and serves the API and team logos.
- `public/` is the static site: one `.html` file per page, shared `styles.css` and
  `app.js`, and `model.js`, which builds standings and simulates the rest of the season
  in the visitor's browser.
- `README.md` covers deployment, the API endpoints, and troubleshooting.

## What's next

See `ROADMAP.md` for planned work, grouped by size. Start there when deciding what to
build.

## Decisions

These choices are deliberate. Don't "fix" them without asking first.

- **Ranking is by points percentage, not total points.** The AHL ranks teams this way
  (points ÷ possible points), then breaks ties by RW, then ROW. That's why the order
  can differ from sites like FloHockey, which sort by total points.
- **Tables scroll sideways instead of hiding columns.** Every column shows on every
  device; on phones, the rank, movement arrow, and team stay pinned on the left.
- **Data updates once a day, at 3 a.m. Pacific, on purpose.** By then even late West
  Coast games are final. Once a day is enough for following the standings, stays well
  within Cloudflare's free plan, and keeps the load light on the AHL's unofficial
  stats feed. Don't add more frequent or live updates.
- **Playoff odds are simulated in the visitor's browser** (`public/model.js`), not in
  the worker, so the nightly job stays well under the free plan's CPU limit.

## Working rules

- **Push back honestly.** If an idea doesn't make sense, adds little, or conflicts with
  how the AHL actually works, say so and explain why before building it. Suggest a
  better option when there is one.
- **Keep it simple.** The site should stay easy to use and easy to maintain. Prefer
  small changes to existing pages over new pages, menu items, settings, or
  dependencies. If a feature would make the site cumbersome, propose a lighter version.
- **No attribution in commits or pull requests.** Don't add Co-Authored-By,
  Claude-Session, "Generated with Claude Code", or any other attribution lines. Just a
  plain description of the change.
- **With every change:**
  - Add an entry to `CHANGELOG.md`, newest entry at the top, under a dated heading
    (e.g. `## October 18, 2026`). Write it in plain English for site visitors.
  - Tick off the item in `ROADMAP.md` (`- [x]`), or update it if the plan changed or
    new work came up.
