# Roadmap

Guiding rule: add what helps follow the playoff race, without making the site
cumbersome. Check items off as they ship.

## Milestone 0: Confirm the live site works
- [x] Updated for the 2026-27 realignment (Bridgeport moved to Hamilton, now in the North)
- [ ] `/api/status` shows `"ok": true` with 32 teams and about 1,150 games
- [ ] Standings match theahl.com after a game night
- [ ] `/api/logos` shows a logo for every team
- [ ] Any outdated logos fixed through `LOGO_OVERRIDES`

## Milestone 1: Column guide
- [ ] Closed-by-default "What the columns mean" section under each table page
- [ ] Covers every column in plain English, including Bye, Win division, and Proj PTS
- [ ] Says which columns the AHL actually uses to rank teams and which are just context
- [ ] Works on phones (no reliance on hover)

## Milestone 2: Team pages
- [ ] A page for each team at `/team/<team-name>`, reached by tapping a team (no new menu items)
- [ ] Full schedule: results so far and remaining games, with home or away
- [ ] Home and road records, as a line or two rather than new columns
- [ ] The team's own week-by-week chart
- [ ] Team dropdown adds the next three games and a "Full schedule" link

## Milestone 3: Official tiebreakers and playoff format
- [ ] Confirm the 2026-27 playoff format (the app assumes the usual rule: all but the bottom two
      per division make it, bottom three in the Pacific, giving Atlantic 5 of 7 and North 6 of 8)
- [ ] Check the AHL's current tiebreak order
- [ ] Add head-to-head and any other missing steps
- [ ] Use the same rules in the standings and the playoff simulation

## Milestone 4: Clinched and eliminated markers
- [ ] Mark teams that have mathematically clinched a playoff spot, a bye, or the division
- [ ] Mark teams that are mathematically eliminated
- [ ] Short legend explaining the markers

## Milestone 5: Strength of schedule
- [ ] How tough each team's remaining opponents are, based on their records
- [ ] Shown on team pages

## Milestone 6: Finishing-position chart
- [ ] For each team, the chance of finishing 1st, 2nd, 3rd, and so on in its division
- [ ] Shaded grid, one per division
- [ ] Covers likely first-round matchups, so no separate matchup feature is needed

## Milestone 7: Games that matter most
- [ ] This week's upcoming games, ranked by how much each result would swing the playoff odds

## To decide
- [ ] Merge the Conferences page into League with a "Conference / Whole league" switch,
      since conference rank doesn't decide playoff spots

## Not doing
- Scoring leaders: different data to fetch and maintain, and off the site's focus
- Projected matchups as their own feature: covered by Milestone 6
