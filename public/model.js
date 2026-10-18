// Standings math and playoff simulation. Runs in the browser.
(function (root) {
  // AHL Calder Cup qualification (format since 2022): every team qualifies except the
  // bottom two in the Atlantic, North and Central and the bottom three in the Pacific.
  // Byes go to enough top teams that four per division reach the second round
  // (first-round winners plus bye teams = 4), which works out to byes = 8 - spots.
  // Derived from division size, so realignments like Bridgeport moving to Hamilton
  // (and the North) for 2026-27 are handled automatically.
  // To override a division by hand: PLAYOFF_RULES.North = { spots: 6, byes: 2 }.
  const PLAYOFF_RULES = {};
  const MISS = { Pacific: 3 };

  function rulesFor(div, size) {
    if (PLAYOFF_RULES[div]) return PLAYOFF_RULES[div];
    const spots = Math.max(1, size - (MISS[div] || 2));
    return { spots, byes: Math.max(1, Math.min(spots, 8 - spots)) };
  }

  const pctOf = (t) => (t.gp ? t.pts / (2 * t.gp) : 0);

  // AHL tiebreakers, simplified: points %, regulation wins, regulation + OT wins, wins, goal differential.
  function compare(a, b) {
    return pctOf(b) - pctOf(a) || b.rw - a.rw || b.row - a.row || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga) || a.name.localeCompare(b.name);
  }

  function computeStandings(data) {
    const rows = new Map();
    for (const t of data.teams) {
      rows.set(t.id, { ...t, gp: 0, w: 0, l: 0, otl: 0, sol: 0, pts: 0, gf: 0, ga: 0, rw: 0, row: 0, results: [], home: [0, 0, 0], away: [0, 0, 0] });
    }
    for (const [date, h, a, hg, ag, type] of data.games) {
      if (!type) continue;
      const home = rows.get(h), away = rows.get(a);
      const homeWon = hg > ag;
      const [win, lose] = homeWon ? [home, away] : [away, home];
      for (const [t, gf, ga] of [[home, hg, ag], [away, ag, hg]]) { t.gp++; t.gf += gf; t.ga += ga; }
      win.w++; win.pts += 2; win.results.push({ date, r: "W" });
      if (type === 1) { win.rw++; win.row++; lose.l++; lose.results.push({ date, r: "L" }); }
      else {
        if (type === 2) win.row++;
        lose.pts += 1; // overtime and shootout losses earn a point
        type === 2 ? lose.otl++ : lose.sol++;
        lose.results.push({ date, r: type === 2 ? "OTL" : "SOL" });
      }
      const hr = home.home, ar = away.away;
      if (homeWon) { hr[0]++; type === 1 ? ar[1]++ : ar[2]++; } else { ar[0]++; type === 1 ? hr[1]++ : hr[2]++; }
    }
    for (const t of rows.values()) {
      t.pct = pctOf(t);
      t.gd = t.gf - t.ga;
      const last = t.results.slice(-10);
      const n10 = (r) => last.filter((x) => x.r === r).length;
      t.l10 = `${n10("W")}-${n10("L")}-${n10("OTL")}-${n10("SOL")}`; // AHL style: W-L-OTL-SOL
      let n = 0; const lastR = t.results.length ? t.results[t.results.length - 1].r : null;
      for (let i = t.results.length - 1; i >= 0 && t.results[i].r === lastR; i--) n++;
      t.streak = lastR ? `${lastR}${n}` : "";
      t.remaining = 0;
    }
    for (const [, h, a, , , type] of data.games) if (!type) { rows.get(h).remaining++; rows.get(a).remaining++; }

    const teams = [...rows.values()];
    const groupBy = (key) => {
      const out = {};
      for (const t of teams) (out[t[key]] ||= []).push(t);
      for (const k in out) out[k].sort(compare);
      return out;
    };
    const divisions = groupBy("div");
    for (const [div, list] of Object.entries(divisions)) {
      const rules = rulesFor(div, list.length);
      list.forEach((t, i) => { t.divRank = i + 1; t.spots = rules.spots; t.byes = rules.byes; });
    }
    const conferences = groupBy("conf");
    for (const list of Object.values(conferences)) list.forEach((t, i) => (t.confRank = i + 1));
    const league = teams.slice().sort(compare);
    league.forEach((t, i) => (t.leagueRank = i + 1));
    return { byId: rows, teams, divisions, conferences, league };
  }

  // Seeded random numbers so everyone sees the same odds for the same day's data.
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashString(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

  // Monte Carlo: play out every remaining game many times.
  // Team strength = points % so far, pulled toward .500 (heavily early in the season),
  // plus random variation each simulated season that narrows as more games are played.
  function simulate(data, standings, sims = 5000) {
    const teams = standings.teams;
    const idx = new Map(teams.map((t, i) => [t.id, i]));
    const N = teams.length;
    const PRIOR_GAMES = 30, SCALE = 0.85, HOME_EDGE = 0.07, SPREAD = 0.32, OT_RATE = 0.23, SO_SHARE = 0.4;

    const base = teams.map((t) => {
      const adj = (t.pts + PRIOR_GAMES) / (2 * (t.gp + PRIOR_GAMES));
      return SCALE * Math.log(adj / (1 - adj));
    });
    // Uncertainty about each team's true strength shrinks as games are played.
    const noise = teams.map((t) => SPREAD * Math.sqrt(PRIOR_GAMES / (PRIOR_GAMES + t.gp)));
    const remaining = data.games.filter((g) => !g[5]).map((g) => [idx.get(g[1]), idx.get(g[2])]);
    const divGroups = {};
    teams.forEach((t, i) => (divGroups[t.div] ||= []).push(i));

    const out = teams.map(() => ({ playoffs: 0, bye: 0, divTitle: 0, pts: 0, presidents: 0 }));
    const rng = mulberry32(hashString(data.updatedAt || "x"));
    const gauss = () => Math.sqrt(-2 * Math.log(rng() || 1e-12)) * Math.cos(2 * Math.PI * rng());

    const pts = new Float64Array(N), gp = new Float64Array(N), rw = new Float64Array(N), row = new Float64Array(N), tie = new Float64Array(N), r = new Float64Array(N);
    const sortKey = (i, j) => pts[j] / (2 * gp[j] || 1) - pts[i] / (2 * gp[i] || 1) || rw[j] - rw[i] || row[j] - row[i] || tie[j] - tie[i];

    for (let s = 0; s < sims; s++) {
      for (let i = 0; i < N; i++) {
        const t = teams[i];
        pts[i] = t.pts; gp[i] = t.gp; rw[i] = t.rw; row[i] = t.row; tie[i] = rng();
        r[i] = base[i] + noise[i] * gauss();
      }
      for (const [h, a] of remaining) {
        const p = 1 / (1 + Math.exp(-(r[h] - r[a] + HOME_EDGE)));
        gp[h]++; gp[a]++;
        if (rng() < OT_RATE) {
          const so = rng() < SO_SHARE;
          const homeWins = rng() < 0.5 + (p - 0.5) * (so ? 0.2 : 0.5);
          const [w, l] = homeWins ? [h, a] : [a, h];
          pts[w] += 2; pts[l] += 1; if (!so) row[w]++;
        } else {
          const w = rng() < p ? h : a;
          pts[w] += 2; rw[w]++; row[w]++;
        }
      }
      let best = 0;
      for (let i = 1; i < N; i++) if (sortKey(i, best) < 0) best = i;
      out[best].presidents++;
      for (const [div, members] of Object.entries(divGroups)) {
        const rules = rulesFor(div, members.length);
        const order = members.slice().sort(sortKey);
        order.forEach((i, rank) => {
          if (rank === 0) out[i].divTitle++;
          if (rank < rules.byes) out[i].bye++;
          if (rank < rules.spots) out[i].playoffs++;
        });
      }
      for (let i = 0; i < N; i++) out[i].pts += pts[i];
    }

    const result = new Map();
    teams.forEach((t, i) => {
      const o = out[i];
      const gpFinal = t.gp + t.remaining;
      result.set(t.id, {
        playoffs: o.playoffs / sims, bye: o.bye / sims, divTitle: o.divTitle / sims, presidents: o.presidents / sims,
        projPts: o.pts / sims, projPct: gpFinal ? o.pts / sims / (2 * gpFinal) : 0,
      });
    });
    return { byId: result, sims, gamesLeft: remaining.length };
  }

  // ---- Weekly movement ----
  // A "week" is Monday to Sunday, matching the AHL's weekend-heavy schedule.
  // We rebuild the standings as they stood after each of the last two Sundays
  // from the game results, so no separate weekly snapshot needs to be stored.
  const pacificDate = (iso) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const addDays = (s, n) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  function lastWeek(updatedAt) {
    const yesterday = addDays(pacificDate(updatedAt), -1); // last fully finished day
    const end = addDays(yesterday, -new Date(`${yesterday}T00:00:00Z`).getUTCDay()); // most recent Sunday
    return { start: addDays(end, -6), end, prevEnd: addDays(end, -7) };
  }

  function asOf(data, cutoff) {
    return { ...data, updatedAt: cutoff, games: data.games.map((g) => (g[5] && g[0] <= cutoff ? g : [g[0], g[1], g[2], null, null, 0])) };
  }

  function record(id, games) {
    const rec = [0, 0, 0, 0]; // W-L-OTL-SOL
    for (const g of games) {
      const home = g[1] === id, won = home ? g[3] > g[4] : g[4] > g[3];
      rec[won ? 0 : g[5] === 1 ? 1 : g[5] === 2 ? 2 : 3]++;
    }
    return rec;
  }
  const points = (rec) => rec[0] * 2 + rec[2] + rec[3];

  function weekly(data, sims = 2000) {
    const w = lastWeek(data.updatedAt);
    const A = asOf(data, w.end), B = asOf(data, w.prevEnd);
    const sA = computeStandings(A), sB = computeStandings(B);
    const oA = simulate(A, sA, sims), oB = simulate(B, sB, sims);
    const ranked = B.games.some((g) => g[5]); // before opening weekend there's no "previous rank"
    const byId = new Map();
    for (const a of sA.teams) {
      const b = sB.byId.get(a.id);
      const mine = data.games.filter((g) => g[5] && (g[1] === a.id || g[2] === a.id));
      const games = mine.filter((g) => g[0] >= w.start && g[0] <= w.end);
      const since = mine.filter((g) => g[0] > w.end); // this week so far, through last night
      const rec = record(a.id, games), recSince = record(a.id, since);
      byId.set(a.id, {
        divRank: a.divRank, confRank: a.confRank, leagueRank: a.leagueRank,
        dDiv: ranked ? b.divRank - a.divRank : null,
        dConf: ranked ? b.confRank - a.confRank : null,
        dLeague: ranked ? b.leagueRank - a.leagueRank : null,
        odds: oA.byId.get(a.id).playoffs,
        dOdds: oA.byId.get(a.id).playoffs - oB.byId.get(a.id).playoffs,
        games, record: rec, pts: points(rec),
        since, sinceRecord: recSince, sincePts: points(recSince),
      });
    }
    return { ...w, byId, anyGames: data.games.some((g) => g[5] && g[0] >= w.start && g[0] <= w.end) };
  }

  // ---- Week-by-week history for the trend chart ----
  // Weeks run Monday to Sunday. Week 1 is the week of opening night.
  // Only finished weeks are included; a new point appears every Monday.
  function weekSeries(data) {
    if (!data.games.length) return [];
    const first = data.games[0][0];
    const firstMonday = addDays(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
    const lastEnd = lastWeek(data.updatedAt).end;
    const weeks = [];
    for (let start = firstMonday, n = 1; addDays(start, 6) <= lastEnd; start = addDays(start, 7), n++) {
      const end = addDays(start, 6);
      const snap = asOf(data, end);
      weeks.push({ n, start, end, data: snap, st: computeStandings(snap) });
    }
    return weeks;
  }

  function weekOdds(week, sims = 1000) {
    return simulate(week.data, week.st, sims).byId;
  }

  root.AHL = { computeStandings, simulate, weekly, lastWeek, weekSeries, weekOdds, PLAYOFF_RULES, rulesFor };
})(typeof window !== "undefined" ? window : globalThis);
