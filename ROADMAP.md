# Roadmap

Guiding rule: add what helps follow the playoff race, without making the site
cumbersome. To-dos are grouped by how much work they take. Check them off as they ship.

## Done
- [x] Updated for the 2026-27 realignment (Bridgeport moved to Hamilton, now in the North)
- [x] Standings verified against the official AHL standings (all 32 teams matched)

## Milestone 1: Quick wins
Small changes, mostly a few lines each.

- [ ] Once the latest code is live, check `/api/status` (ok, 32 teams, about 1,150 games)
- [ ] Check `/api/logos` and fix any outdated logos through `LOGO_OVERRIDES`
- [ ] Confirm the 2026-27 playoff format (the app assumes Atlantic 5 of 7, North 6 of 8,
      Central 5 of 7, Pacific 7 of 10). As of October 17 there's no 2026-27 announcement;
      the AHL has used the same rule every season since 2022
- [x] Show RW (regulation wins) and ROW (regulation + overtime wins) columns so the order
      of tied teams makes sense
- [x] Scrollable tables with every column on every device; rank, arrow, and team pinned
- [x] Closed-by-default "What the columns mean" section under each table page, in plain
      English and readable on phones
- [x] In that section, say which columns the AHL uses to rank teams and which are just context
- [x] In that section, one line on why the order can differ from sites like FloHockey: they
      sort by total points, while the AHL (and this site) ranks by points percentage
- [x] Show records the AHL way everywhere, W-L-OTL-SOL (four numbers), instead of the
      three-number W-L-OT on the odds page, last-week records, and L10. Overtime and shootout
      losses each earn a point, so they should be visible separately
- [x] In team dropdowns, label shootout losses "SOL" instead of "OTL"
- [x] Team dropdowns show this week's games so far (through last night) above last week's
      summary; arrows and ranks stay weekly
- [x] Playoff odds rebuilt on schedule- and home-adjusted goal differential, with a realistic home
      edge and this season's OT and shootout rates; odds arrows no longer move from simulation noise
- [x] Change log: a `CHANGELOG.md` in the repo, shown on a small "What's new" page linked
      from the footer (not the menu)

## Milestone 2: Medium
New pages or new calculations, built on data the app already has.

- [ ] Team pages at `/team/<team-name>`, reached by tapping a team (no new menu items)
- [ ] Team page: full schedule, with results so far and remaining games, home or away
- [ ] Team page: home and road records, as a line or two
- [ ] Team page: the team's own week-by-week chart
- [ ] Team dropdown: next three games and a "Full schedule" link (needs team pages)
- [ ] Strength of schedule on team pages: how tough the remaining opponents are
- [ ] Finishing-position chart: each team's chance of finishing 1st, 2nd, 3rd, and so on in
      its division, as a shaded grid (also covers likely first-round matchups)
- [ ] Check the AHL's official tiebreak order and add the missing steps, like head-to-head,
      in both the standings and the simulation

## Milestone 3: Hard
Tricky logic that needs careful testing.

- [ ] Clinched markers: playoff spot, bye, and division, proven mathematically rather than
      by odds (points percentage and uneven games played make this harder than usual)
- [ ] Eliminated markers, plus a short legend for all markers
- [ ] Games that matter most: this week's games ranked by how much each result would swing
      the playoff odds

## To decide
- [ ] Merge the Conferences page into League with a "Conference / Whole league" switch,
      since conference rank doesn't decide playoff spots
- [ ] Parked: starting lineups for the next game. The AHL posts lineups only shortly before
      puck drop, and the site updates once a day, so it couldn't show them reliably. If
      revisited, the practical version is linking each team's next game to its official AHL
      game page (medium, alongside team pages)
- [ ] NHL call-ups: a "Recent transactions" list on team pages with links to the official
      source. Call-ups explain sudden slumps and hot streaks, but it's player-level data like
      scoring leaders, changes almost daily, and the feed's support for it is unconfirmed (hard)

## Not doing
- Scoring leaders: different data to fetch and maintain, and off the site's focus
- Projected matchups as their own feature: covered by the finishing-position chart
