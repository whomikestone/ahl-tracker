// AHL standings tracker: Cloudflare Worker
// - Nightly (3 a.m. Pacific) pulls teams + full schedule/results from the
//   HockeyTech feed that powers theahl.com and stores a compact copy in KV.
// - Serves that copy at /api/data. The page in ./public does the standings
//   math and playoff simulation in the browser.

const FEED = "https://lscluster.hockeytech.com/feed/index.php";
const PUBLIC_KEY = "50c2cd9b5e18e390"; // public key embedded in theahl.com
const CLIENT = "ahl";

const DIVISIONS = ["Atlantic", "North", "Central", "Pacific"];
const CONFERENCE = { Atlantic: "Eastern", North: "Eastern", Central: "Western", Pacific: "Western" };

// Used only if the feed doesn't say which division a team is in.
const DIVISION_BY_NAME = {
  Atlantic: ["Bridgeport", "Charlotte", "Hartford", "Hershey", "Lehigh", "Providence", "Springfield", "Wilkes"],
  North: ["Belleville", "Cleveland", "Laval", "Rochester", "Syracuse", "Toronto", "Utica"],
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

async function refresh(env) {
  const season = await findSeason(env);
  const rawTeams = list(await feed(env, { view: "teamsbyseason", season_id: season.id }), "Teamsbyseason");
  const teams = rawTeams
    .filter((t) => t.id && t.name)
    .map((t) => {
      const div = divisionFor(t);
      return { id: String(t.id), name: t.name, code: t.code || "", nickname: t.nickname || "", city: t.city || "", div, conf: CONFERENCE[div] || "" };
    });
  const ids = new Set(teams.map((t) => t.id));

  const rawGames = list(await feed(env, { view: "schedule", season_id: season.id }), "Schedule");
  // Compact game rows: [date, homeId, awayId, homeGoals, awayGoals, type]
  // type: 0 = not played, 1 = regulation, 2 = overtime, 3 = shootout
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
  await env.DATA.put("status", JSON.stringify({ ok: true, at: data.updatedAt, teams: teams.length, games: games.length }));
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

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extra } });

export default {
  async fetch(request, env) {
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

    if (url.pathname === "/api/status") {
      return json(JSON.parse((await env.DATA.get("status")) || '{"ok":null}'), 200, { "Cache-Control": "no-store" });
    }

    // Manual refresh: /api/refresh?token=YOUR_REFRESH_TOKEN
    if (url.pathname === "/api/refresh") {
      if (!env.REFRESH_TOKEN || url.searchParams.get("token") !== env.REFRESH_TOKEN) return json({ error: "Wrong or missing token" }, 403);
      try {
        const d = await safeRefresh(env);
        return json({ ok: true, updatedAt: d.updatedAt, season: d.season, teams: d.teams.length, games: d.games.length });
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
