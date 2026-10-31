// AHL standings tracker: Cloudflare Worker
// - Nightly (3 a.m. Pacific) pulls teams + full schedule/results from the
//   HockeyTech feed that powers theahl.com and stores a compact copy in KV.
// - Serves that copy at /api/data. The page in ./public does the standings
//   math and playoff simulation in the browser.

import CHANGELOG from "../CHANGELOG.md";
import { changesPage } from "./changelog.js";

const FEED = "https://lscluster.hockeytech.com/feed/index.php";
const PUBLIC_KEY = "50c2cd9b5e18e390"; // public key embedded in theahl.com
const CLIENT = "ahl";

const DIVISIONS = ["Atlantic", "North", "Central", "Pacific"];
const CONFERENCE = { Atlantic: "Eastern", North: "Eastern", Central: "Western", Pacific: "Western" };

// Used only if the feed doesn't say which division a team is in.
const DIVISION_BY_NAME = {
  Atlantic: ["Charlotte", "Hartford", "Hershey", "Lehigh", "Providence", "Springfield", "Wilkes"],
  North: ["Belleville", "Cleveland", "Hamilton", "Laval", "Rochester", "Syracuse", "Toronto", "Utica"],
  Central: ["Chicago", "Grand Rapids", "Iowa", "Manitoba", "Milwaukee", "Rockford", "Texas"],
  Pacific: ["Abbotsford", "Bakersfield", "Calgary", "Coachella", "Colorado", "Henderson", "Ontario", "San Diego", "San Jose", "Tucson"],
};

async function feed(env, params) {
  const url = new URL(FEED);
  const all = { feed: "modulekit", key: PUBLIC_KEY, client_code: CLIENT, fmt: "json", lang: "en", ...params };
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (personal AHL standings tracker)", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Stats feed (${params.view}) returned HTTP ${res.status}`);
  let text = (await res.text()).trim();
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1); // JSONP-style wrapper
  const json = JSON.parse(text);
  return json.SiteKit || json;
}

function list(obj, key) {
  const v = obj[key] ?? Object.values(obj).find(Array.isArray);
  return Array.isArray(v) ? v : [];
}

async function findSeason(env) {
  if (env.SEASON_ID) return { id: String(env.SEASON_ID), name: `Season ${env.SEASON_ID}` };
  const seasons = list(await feed(env, { view: "seasons" }), "Seasons");
  const today = new Date().toISOString().slice(0, 10);
  const regular = seasons.filter(
    (s) => /regular/i.test(s.season_name || "") && String(s.playoff) !== "1" && !/all.?star|exhibition|pre.?season/i.test(s.season_name || "")
  );
  const pool = (regular.length ? regular : seasons).slice().sort(
    (a, b) => String(b.start_date || "").localeCompare(String(a.start_date || "")) || Number(b.season_id) - Number(a.season_id)
  );
  // Newest season that has started; otherwise the newest one listed.
  const s = pool.find((x) => !x.start_date || x.start_date <= today) || pool[0];
  if (!s) throw new Error("Couldn't find a regular season in the stats feed");
  return { id: String(s.season_id), name: s.season_name || `Season ${s.season_id}` };
}

function divisionFor(team) {
  const label = [team.division_long_name, team.division_short_name, team.division_name, team.division].filter(Boolean).join(" ");
  const fromFeed = DIVISIONS.find((d) => label.toLowerCase().includes(d.toLowerCase()));
  if (fromFeed) return fromFeed;
  const name = `${team.city || ""} ${team.name || ""}`;
  for (const [div, keys] of Object.entries(DIVISION_BY_NAME)) if (keys.some((k) => name.includes(k))) return div;
  return "Other";
}

function gameType(g) {
  const status = String(g.game_status || g.status_name || "");
  const final = String(g.final) === "1" || String(g.status) === "4" || /^final/i.test(status);
  if (!final) return 0;
  if (/\bSO\b|shootout/i.test(status)) return 3;
  if (/OT/i.test(status)) return 2;
  return 1;
}

// Puck-drop time as "YYYY-MM-DDTHH:MM:00-05:00", from whichever schedule fields the feed fills in:
// a full ISO date-time, a time like "7:05 pm EST" (game_status before puck drop), or a 24-hour
// time plus a time zone name. Returns null if none gives a real time.
const TZ_ABBR = { EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AST: -4, ADT: -3 };
const pad = (n) => String(n).padStart(2, "0");
// Standard UTC offsets for the time zones AHL arenas use. All observe daylight time except
// Arizona (Tucson). A small table instead of Intl time zones, which are slow to load and would
// push the nightly job past the free plan's CPU limit.
const ZONES = [[/Phoenix|Arizona/i, -7, false], [/New_York|Toronto|Detroit|Montreal|Eastern/i, -5, true],
  [/Chicago|Winnipeg|Central/i, -6, true], [/Denver|Edmonton|Boise|Mountain/i, -7, true], [/Los_Angeles|Vancouver|Pacific/i, -8, true]];
// US and Canadian daylight time: second Sunday in March to first Sunday in November.
function inDaylightTime(date) {
  const [y, m, d] = date.split("-").map(Number);
  const sunday = (month, nth) => 1 + ((7 - new Date(Date.UTC(y, month - 1, 1)).getUTCDay()) % 7) + 7 * (nth - 1);
  return (m > 3 || (m === 3 && d >= sunday(3, 2))) && (m < 11 || (m === 11 && d < sunday(11, 1)));
}
const offsets = new Map(); // "America/Chicago|2026-11-20" -> -6, worked out once per zone and day
function zoneOffset(tz, date) {
  const key = `${tz}|${date}`;
  if (!offsets.has(key)) {
    const z = ZONES.find(([re]) => re.test(tz));
    offsets.set(key, z ? z[1] + (z[2] && inDaylightTime(date) ? 1 : 0) : undefined);
  }
  return offsets.get(key);
}
function startOf(g) {
  const iso = String(g.GameDateISO8601 || "");
  if (/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?([+-]\d\d:?\d\d|Z)$/.test(iso) && !/T00:00/.test(iso)) return iso;
  const date = String(g.date_played || iso).slice(0, 10);
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) return null;
  for (const text of [g.game_status, g.scheduled_time, g.schedule_time, g.game_time, g.time]) {
    const t = String(text || "").trim().match(/^(\d{1,2}):(\d\d)(?::\d\d)?\s*(am|pm)?\s*([A-Z]{2,4})?\b/i);
    if (!t) continue;
    let h = Number(t[1]);
    if (t[3]) h = (h % 12) + (/pm/i.test(t[3]) ? 12 : 0);
    if (h > 23 || (h === 0 && !t[3])) continue;
    const off = TZ_ABBR[(t[4] || "").toUpperCase()] ?? (g.timezone ? zoneOffset(String(g.timezone), date) : undefined);
    if (off === undefined) continue;
    const sign = off < 0 ? "-" : "+", a = Math.abs(off);
    return `${date}T${pad(h)}:${t[2]}:00${sign}${pad(Math.floor(a))}:${pad(Math.round((a % 1) * 60))}`;
  }
  return null;
}

async function refresh(env) {
  const season = await findSeason(env);
  const rawTeams = list(await feed(env, { view: "teamsbyseason", season_id: season.id }), "Teamsbyseason");
  const teams = rawTeams
    .filter((t) => t.id && t.name)
    .map((t) => {
      const div = divisionFor(t);
      const logo = [t.team_logo_url, t.logo_url, t.team_logo, t.logo, ...Object.entries(t).filter(([k]) => /logo/i.test(k)).map(([, v]) => v)]
        .find((v) => typeof v === "string" && /^https?:\/\//.test(v)) || "";
      return { id: String(t.id), name: t.name, code: t.code || "", nickname: t.nickname || "", city: t.city || "", div, conf: CONFERENCE[div] || "", logo };
    });
  const ids = new Set(teams.map((t) => t.id));

  const rawGames = list(await feed(env, { view: "schedule", season_id: season.id }), "Schedule");
  // Compact game rows: [date, homeId, awayId, homeGoals, awayGoals, type, gameId, start]
  // type: 0 = not played, 1 = regulation, 2 = overtime, 3 = shootout
  // start: puck-drop time with its UTC offset, kept only for games not yet played.
  const games = rawGames
    .filter((g) => !/cancel/i.test(String(g.game_status || "")))
    .map((g) => {
      const type = gameType(g);
      return [
        String(g.date_played || g.GameDateISO8601 || "").slice(0, 10),
        String(g.home_team),
        String(g.visiting_team),
        type ? Number(g.home_goal_count) : null,
        type ? Number(g.visiting_goal_count) : null,
        type,
        String(g.game_id || g.id || ""),
        type ? null : startOf(g),
      ];
    })
    .filter((g) => ids.has(g[1]) && ids.has(g[2]))
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Sanity check so a bad response never overwrites good data.
  if (teams.length < 20 || games.length < 500) {
    throw new Error(`Stats feed looked incomplete (${teams.length} teams, ${games.length} games); kept yesterday's data`);
  }

  const data = { updatedAt: new Date().toISOString(), season, teams, games };
  await env.DATA.put("data", JSON.stringify(data));
  // How many upcoming games got a start time, plus one upcoming game exactly as the feed sent it,
  // so a missing time can be traced to the feed's field names from /api/status.
  const upcoming = games.filter((g) => !g[5]);
  const rawUpcoming = rawGames.find((g) => !gameType(g) && !/cancel/i.test(String(g.game_status || "")));
  await env.DATA.put("status", JSON.stringify({
    ok: true, at: data.updatedAt, teams: teams.length, games: games.length,
    times: `${upcoming.filter((g) => g[7]).length} of ${upcoming.length} upcoming games have a start time`,
    sampleUpcomingGame: rawUpcoming || null,
  }));
  return data;
}

async function safeRefresh(env) {
  try {
    return await refresh(env);
  } catch (err) {
    await env.DATA.put("status", JSON.stringify({ ok: false, at: new Date().toISOString(), error: String(err.message || err) }));
    throw err;
  }
}

function pacific(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "numeric", hourCycle: "h23",
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: Number(get("minute")) };
}

// ---- Goal-by-goal summaries ----
// Fetched from the feed the first time someone opens a finished game, then kept
// for good (finished games don't change), so each game is fetched at most once.
// The feed's game summary format isn't documented, so this accepts the field names
// HockeyTech is known to use and only keeps a summary whose goal count matches the
// final score. Anything else shows visitors a link to the official game page instead.
const SUMMARY_VERSION = 1;
const flag = (v) => v === true || String(v) === "1";
const person = (p) => (p && typeof p === "object" ? [p.first_name ?? p.firstName, p.last_name ?? p.lastName].filter(Boolean).join(" ") : "");

function parseGoals(raw) {
  const s = raw.Gamesummary || raw.GameSummary || raw;
  let goals = s.goals;
  if (!Array.isArray(goals) && Array.isArray(s.periods)) {
    goals = s.periods.flatMap((p) => (Array.isArray(p.goals) ? p.goals.map((g) => ({ ...g, _period: p.info || p })) : []));
  }
  if (!Array.isArray(goals)) return null;
  return goals.map((g) => {
    const props = g.properties || {};
    const assists = Array.isArray(g.assists) ? g.assists : [g.assist1_player, g.assist2_player];
    return {
      period: Number(g.period_id ?? (g.period && g.period.id) ?? (g._period && g._period.id)) || 0,
      time: String(g.time || ""),
      team: String(g.team_id ?? (g.team && g.team.id) ?? ""),
      scorer: person(g.goal_scorer || g.scorer),
      assists: assists.map(person).filter(Boolean),
      pp: flag(g.power_play ?? props.isPowerPlay),
      sh: flag(g.short_handed ?? props.isShortHanded),
      en: flag(g.empty_net ?? props.isEmptyNet),
      ps: flag(g.penalty_shot ?? props.isPenaltyShot),
    };
  });
}

const SUMMARY_SOURCES = (id) => [{ view: "gamesummary", game_id: id }, { feed: "statviewfeed", view: "gameSummary", game_id: id }];

// Reads one feed answer for schedule row g. Returns { goals } if every goal checks out
// against the final score, or { reason } saying why not.
function checkGoals(raw, g) {
  let goals = parseGoals(raw);
  if (!goals) return { reason: "no goals list found in the answer" };
  if (g[5] === 3) goals = goals.filter((x) => x.period <= 4); // leave out shootout attempts
  // Goals each team scored before any shootout (a shootout win adds one to the winner's score).
  const so = g[5] === 3;
  const expected = { [g[1]]: g[3] - (so && g[3] > g[4] ? 1 : 0), [g[2]]: g[4] - (so && g[4] > g[3] ? 1 : 0) };
  const bad = goals.find((x) => !x.scorer || !x.period || !(x.team in expected));
  if (bad) return { reason: `a goal is missing its scorer, period, or a team from this game: ${JSON.stringify(bad)}` };
  const counts = [g[1], g[2]].map((t) => goals.filter((x) => x.team === t).length);
  if (counts[0] !== expected[g[1]] || counts[1] !== expected[g[2]]) {
    return { reason: `goal counts ${counts.join("-")} (home-away) don't match the score ${expected[g[1]]}-${expected[g[2]]}` };
  }
  return { goals };
}

async function serveGame(env, id) {
  if (!/^\d+$/.test(id)) return json({ error: "Unknown game" }, 404);
  const key = `game:v${SUMMARY_VERSION}:${id}`;
  const cached = await env.DATA.get(key);
  const hdr = { "Cache-Control": "public, max-age=86400" };
  if (cached) return new Response(cached, { headers: { "Content-Type": "application/json", ...hdr } });

  // Only finished games from this season's schedule, so the feed is never asked for anything else.
  const miss = { "Cache-Control": "public, max-age=3600" };
  if (await env.DATA.get(`${key}:miss`)) return json({ goals: null }, 200, miss); // tried within the last day

  const data = JSON.parse((await env.DATA.get("data")) || "null");
  const g = data && data.games.find((x) => x[6] === id);
  if (!g || !g[5]) return json({ error: "Not a finished game" }, 404);
  for (const params of SUMMARY_SOURCES(id)) {
    try {
      const { goals } = checkGoals(await feed(env, params), g);
      if (!goals) continue;
      const body = JSON.stringify({ goals });
      await env.DATA.put(key, body);
      return new Response(body, { headers: { "Content-Type": "application/json", ...hdr } });
    } catch {}
  }
  await env.DATA.put(`${key}:miss`, "1", { expirationTtl: 86400 });
  return json({ goals: null }, 200, miss);
}

// What the feed sends for one game, cut down to something readable, and why it was or wasn't
// accepted: /api/game-check/<game id>?token=YOUR_REFRESH_TOKEN. For fixing parseGoals.
function outline(v, depth = 0) {
  if (Array.isArray(v)) return v.length ? [`${v.length} items, first:`, depth < 3 ? outline(v[0], depth + 1) : "…"] : "empty list";
  if (v && typeof v === "object") {
    if (depth >= 3) return `{${Object.keys(v).slice(0, 12).join(", ")}${Object.keys(v).length > 12 ? ", …" : ""}}`;
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, outline(x, depth + 1)]));
  }
  return typeof v === "string" && v.length > 60 ? `${v.slice(0, 60)}…` : v;
}
function firstGoal(v, path = "") {
  if (!v || typeof v !== "object") return null;
  for (const [k, x] of Object.entries(v)) {
    if (Array.isArray(x) && /goal/i.test(k) && x[0] && typeof x[0] === "object") return { at: `${path}${k}`, count: x.length, first: x[0] };
    const found = firstGoal(x, `${path}${k}.`);
    if (found) return found;
  }
  return null;
}
async function checkGame(env, id) {
  const data = JSON.parse((await env.DATA.get("data")) || "null");
  const g = data && data.games.find((x) => x[6] === id);
  if (!g || !g[5]) return json({ error: "Not a finished game in this season's schedule" }, 404, { "Cache-Control": "no-store" });
  const report = { game: id, score: `${g[3]}-${g[4]} (home-away)`, sources: [] };
  for (const params of SUMMARY_SOURCES(id)) {
    const entry = { request: params };
    try {
      const raw = await feed(env, params);
      const result = checkGoals(raw, g);
      entry.accepted = !!result.goals;
      if (result.reason) entry.reason = result.reason;
      entry.firstGoalAsSent = firstGoal(raw);
      entry.outline = outline(raw);
    } catch (err) {
      entry.error = String(err.message || err);
    }
    report.sources.push(entry);
  }
  return json(report, 200, { "Cache-Control": "no-store" });
}

// ---- Team logos ----
// If a team ever shows an outdated logo, add its correct image address here.
// To find one: open the team's page on theahl.com, right-click the logo, and
// choose "Copy Image Address". Then bump LOGO_VERSION so cached logos refresh.
const LOGO_OVERRIDES = {
  // "Ontario Reign": "https://...png",
};
const LOGO_VERSION = 1;
const LOGO_DAYS = 7;

function logoCandidates(team, seasonId) {
  const base = "https://assets.leaguestat.com/ahl/logos/";
  return [...new Set([
    LOGO_OVERRIDES[team.name],          // your manual fix, if any
    team.logo,                          // current logo address from the AHL feed
    `${base}${team.id}_${seasonId}.png`, // this season's logo
    `${base}50x50/${team.id}_${seasonId}.png`,
    `${base}${team.id}.png`,            // generic logo (can be outdated)
  ].filter(Boolean))];
}

async function serveLogo(env, ctx, id) {
  const key = `logo:v${LOGO_VERSION}:${id}`;
  const cached = await env.DATA.getWithMetadata(key, { type: "arrayBuffer" });
  const headers = (ct, src) => ({ "Content-Type": ct, "Cache-Control": `public, max-age=${LOGO_DAYS * 86400}`, "X-Logo-Source": src });
  if (cached.value) return new Response(cached.value, { headers: headers(cached.metadata.ct, cached.metadata.src) });

  const data = JSON.parse((await env.DATA.get("data")) || "null");
  const team = data && data.teams.find((t) => t.id === id);
  if (!team) return new Response("Unknown team", { status: 404 });
  for (const src of logoCandidates(team, data.season.id)) {
    try {
      const res = await fetch(src, { headers: { Referer: "https://theahl.com/", "User-Agent": "Mozilla/5.0 (personal AHL standings tracker)" } });
      const ct = res.headers.get("Content-Type") || "";
      if (!res.ok || !ct.startsWith("image/")) continue;
      const body = await res.arrayBuffer();
      if (body.byteLength < 200) continue; // placeholder pixel, not a real logo
      ctx.waitUntil(env.DATA.put(key, body, { expirationTtl: LOGO_DAYS * 86400, metadata: { ct, src, name: team.name } }));
      return new Response(body, { headers: headers(ct, src) });
    } catch {}
  }
  return new Response("No logo found", { status: 404, headers: { "Cache-Control": "public, max-age=3600" } });
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/data") {
      let raw = await env.DATA.get("data");
      if (!raw) {
        // First visit after deploying: fetch right away instead of waiting for 3 a.m.
        try {
          raw = JSON.stringify(await safeRefresh(env));
        } catch (err) {
          return json({ error: String(err.message || err) }, 502);
        }
      }
      return new Response(raw, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" } });
    }

    // "What's new" page, built from CHANGELOG.md
    if (url.pathname === "/changes" || url.pathname === "/changes/") {
      return new Response(changesPage(CHANGELOG), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }

    // Team pages: every /team/<team-name> address uses team.html; app.js picks the team from the address.
    if (url.pathname.startsWith("/team/")) return env.ASSETS.fetch(new Request(new URL("/team", url), request));

    // Who scored, period by period, for one finished game: /api/game/<game id>
    if (url.pathname.startsWith("/api/game/")) return serveGame(env, decodeURIComponent(url.pathname.slice(10)));

    if (url.pathname.startsWith("/api/game-check/")) {
      if (!env.REFRESH_TOKEN || url.searchParams.get("token") !== env.REFRESH_TOKEN) return json({ error: "Wrong or missing token" }, 403);
      return checkGame(env, decodeURIComponent(url.pathname.slice(16)));
    }

    // Team logos, served from this site: /logo/<team id>
    if (url.pathname.startsWith("/logo/")) return serveLogo(env, ctx, decodeURIComponent(url.pathname.slice(6)));

    // Which address each stored logo came from, for spotting outdated ones.
    if (url.pathname === "/api/logos") {
      const list = await env.DATA.list({ prefix: `logo:v${LOGO_VERSION}:` });
      return json(list.keys.map((k) => ({ team: k.metadata && k.metadata.name, source: k.metadata && k.metadata.src })), 200, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/status") {
      return json(JSON.parse((await env.DATA.get("status")) || '{"ok":null}'), 200, { "Cache-Control": "no-store" });
    }

    // Manual refresh: /api/refresh?token=YOUR_REFRESH_TOKEN
    if (url.pathname === "/api/refresh") {
      if (!env.REFRESH_TOKEN || url.searchParams.get("token") !== env.REFRESH_TOKEN) return json({ error: "Wrong or missing token" }, 403);
      try {
        const d = await safeRefresh(env);
        return json({ season: d.season, ...JSON.parse(await env.DATA.get("status")) }, 200, { "Cache-Control": "no-store" });
      } catch (err) {
        return json({ ok: false, error: String(err.message || err) }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    const now = pacific(new Date(event.scheduledTime));
    if (now.hour !== 3) return; // the other UTC slot is 2 or 4 a.m. Pacific
    if (now.minute >= 30) {
      // Retry slot: skip if the 3:00 run already succeeded today.
      const status = JSON.parse((await env.DATA.get("status")) || "{}");
      if (status.ok && pacific(new Date(status.at)).day === now.day) return;
    }
    ctx.waitUntil(safeRefresh(env));
  },
};
