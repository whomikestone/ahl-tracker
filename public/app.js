(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const logo = (id) => `/logo/${encodeURIComponent(id)}`; // served and stored by your Worker
  // Team logo with an abbreviation badge underneath; the badge shows until the logo loads, or if it can't.
  const abbr = (t) => (t.code || t.name.split(/\s+/).map((w) => w[0]).join("")).slice(0, 3).toUpperCase();
  const logoBox = (t, cls = "") => `<span class="logo ${cls}"><span class="abbr">${esc(abbr(t))}</span><img src="${logo(t.id)}" alt="" loading="lazy" onload="this.previousElementSibling.style.visibility='hidden'" onerror="this.remove()"></span>`;
  const ord = (n) => n + (["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th");
  const pct = (x) => x.toFixed(3).replace(/^0/, "");
  const signed = (n) => (n > 0 ? `+${n}` : String(n));
  const day = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  // Team page addresses: /team/hershey-bears
  const slug = (t) => t.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const teamUrl = (t) => `/team/${slug(t)}`;
  const teamGames = (id) => state.data.games.filter((g) => g[1] === id || g[2] === id);
  // One game from a team's side: opponent, score, and result (W, L, OTL or SOL).
  function result(t, g) {
    const home = g[1] === t.id;
    const opp = state.st.byId.get(home ? g[2] : g[1]);
    if (!g[5]) return { home, opp };
    const us = home ? g[3] : g[4], them = home ? g[4] : g[3];
    const res = us > them ? "W" : g[5] === 1 ? "L" : g[5] === 2 ? "OTL" : "SOL";
    return { home, opp, us, them, res, extra: g[5] === 2 ? " OT" : g[5] === 3 ? " SO" : "" };
  }

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };

  const state = { data: null, st: null, odds: null, week: null, open: new Set(), view: document.body.dataset.view || "division", fav: store.get("fav") || "", teamId: "" };
  const shortDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const weekRange = (w) => {
    const [a, b] = [new Date(`${w.start}T12:00:00`), new Date(`${w.end}T12:00:00`)];
    return a.getMonth() === b.getMonth() ? `${shortDay(w.start)}–${b.getDate()}` : `${shortDay(w.start)} – ${shortDay(w.end)}`;
  };

  // Green up arrow / red down arrow with how many places a team moved last week.
  function move(d, unit = "") {
    if (d === null || d === undefined) return `<span class="mv-none" aria-label="No change data yet">·</span>`;
    const n = unit ? Math.round(d * 100) : d;
    if (n === 0) return `<span class="mv-none" aria-label="No change">–</span>`;
    const up = n > 0;
    const label = unit ? `${up ? "Up" : "Down"} ${Math.abs(n)} percentage points last week` : `${up ? "Up" : "Down"} ${Math.abs(n)} last week`;
    return `<span class="${up ? "up" : "down"}" aria-label="${label}">${up ? "▲" : "▼"}${Math.abs(n)}</span>`;
  }
  const weekVal = (t, key) => (state.week ? state.week.byId.get(t.id)[key] : undefined);

  function oddsCell(p) {
    if (!state.odds) return `<span class="odds">…</span>`;
    const done = state.odds.gamesLeft === 0;
    const label = done ? (p > 0.5 ? "In" : "Out") : p >= 0.995 ? ">99%" : p > 0 && p < 0.005 ? "<1%" : `${Math.round(p * 100)}%`;
    const cls = p >= 0.8 ? "hi" : p <= 0.2 ? "lo" : "";
    return `<span class="odds ${cls}"><span class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></span>${label}</span>`;
  }

  function teamCell(t, showDiv) {
    const open = state.open.has(t.id);
    return `<td class="team"><button class="tn expand" data-team="${esc(t.id)}" aria-expanded="${open}" title="Show last week">${logoBox(t)}
      <span><span class="full">${esc(t.name)}</span><span class="short">${esc(t.nickname || t.name)}</span>${showDiv ? ` <span class="div-tag">${esc(t.div)}</span>` : ""}</span><span class="chev" aria-hidden="true">▾</span></button></td>`;
  }

  function streakCell(s) { return s ? `<span class="${s.startsWith("W") ? "W" : s.startsWith("L") ? "L" : ""}">${s}</span>` : "–"; }

  const MOVE_KEY = { divRank: "dDiv", confRank: "dConf", leagueRank: "dLeague" };

  // A row plus, when the team is expanded, its "last week" dropdown row.
  // Rink lines move to the dropdown row so they still sit under the team.
  function withDetail(t, rowHtml, cols, lineCls) {
    const fav = t.id === state.fav ? "is-fav" : "";
    if (!state.open.has(t.id)) return `<tr class="${fav} ${lineCls}">${rowHtml}</tr>`;
    return `<tr class="${fav} open">${rowHtml}</tr><tr class="detail ${lineCls}"><td colspan="${cols}">${weekDetail(t)}</td></tr>`;
  }

  function table(list, { lines = false, showDiv = false, rankKey = "divRank" } = {}) {
    const rows = list.map((t) => {
      const o = state.odds && state.odds.byId.get(t.id);
      let line = "";
      if (lines && t.divRank === t.byes && t.byes < list.length) line = "blue-line";
      if (lines && t.divRank === t.spots && t.spots < list.length) line = "red-line";
      const row = `<td class="rank">${t[rankKey]}</td><td class="mv">${state.week ? move(weekVal(t, MOVE_KEY[rankKey])) : ""}</td>${teamCell(t, showDiv)}
        <td>${t.gp}</td><td>${t.w}</td><td>${t.l}</td><td>${t.otl}</td><td>${t.sol}</td>
        <td class="pts">${t.pts}</td><td>${t.gp ? pct(t.pct) : "–"}</td>
        <td>${t.rw}</td><td>${t.row}</td>
        <td>${signed(t.gd)}</td><td>${t.gp ? t.l10 : "–"}</td><td>${streakCell(t.streak)}</td>
        <td>${oddsCell(o ? o.playoffs : 0)}</td>`;
      return withDetail(t, row, 16, line);
    }).join("");
    return `<div class="scroll"><table>
      <thead><tr><th class="rank" scope="col">#</th><th class="mv" scope="col" title="Places moved during last week's games"><span class="sr">Change last week</span></th><th class="team" scope="col">Team</th>
      <th scope="col" title="Games played">GP</th><th scope="col" title="Wins">W</th><th scope="col" title="Regulation losses">L</th>
      <th scope="col" title="Overtime losses">OTL</th><th scope="col" title="Shootout losses">SOL</th>
      <th scope="col" title="Points">PTS</th><th scope="col" title="Points percentage (the AHL ranks by this)">PCT</th>
      <th scope="col" title="Regulation wins (first tiebreaker)">RW</th><th scope="col" title="Regulation + overtime wins (second tiebreaker)">ROW</th>
      <th scope="col" title="Goal differential">GD</th><th scope="col" title="Last 10 games: W-L-OTL-SOL">L10</th>
      <th scope="col" title="Current streak">STK</th><th scope="col"><span class="wide-only">Playoffs</span><span class="narrow-only">Odds</span></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function gameLine(t, g) {
    const home = g[1] === t.id;
    const opp = state.st.byId.get(home ? g[2] : g[1]);
    const us = home ? g[3] : g[4], them = home ? g[4] : g[3];
    const res = us > them ? "W" : g[5] === 1 ? "L" : g[5] === 2 ? "OTL" : "SOL";
    const extra = g[5] === 2 ? " OT" : g[5] === 3 ? " SO" : "";
    return `<li><span class="${us > them ? "W" : "L"}">${res}</span> ${us}–${them}${extra} ${home ? "vs" : "at"} ${esc(opp.nickname || opp.name)} <span class="when">${day(g[0])}</span></li>`;
  }

  function weekDetail(t) {
    const w = state.week;
    if (!w) return `<div class="wk">Working out last week's changes…</div>`;
    const x = w.byId.get(t.id);
    const rec = x.record.join("-"); // W-L-OTL-SOL
    const games = x.games.length ? `<ul class="wk-games">${x.games.map((g) => gameLine(t, g)).join("")}</ul>` : `<p class="wk-none">No games last week.</p>`;
    const cell = (label, rank, d) => `<div><b>${rank}</b> ${move(d)}<span>${label}</span></div>`;
    const next = teamGames(t.id).filter((g) => !g[5]).slice(0, 3).map((g) => {
      const x = result(t, g);
      return `${x.home ? "vs" : "at"} ${esc(x.opp.nickname || x.opp.name)} <span class="when">${shortDay(g[0])}</span>`;
    });
    return `<div class="wk">
      <p class="wk-head">Week of ${weekRange(w)}${x.games.length ? `: <b>${rec}</b>, ${x.pts} point${x.pts === 1 ? "" : "s"}` : ""}</p>
      ${games}
      <div class="wk-grid">
        ${cell("Division rank", ord(x.divRank), x.dDiv)}
        ${cell("Conference rank", ord(x.confRank), x.dConf)}
        ${cell("League rank", ord(x.leagueRank), x.dLeague)}
        <div><b>${Math.round(x.odds * 100)}%</b> ${move(x.dOdds, "pts")}<span>Playoff odds</span></div>
      </div>
      ${x.dDiv === null ? `<p class="wk-none">Rank changes start after the first full week of the season.</p>` : ""}
      ${next.length ? `<p class="wk-next"><b>Next:</b> ${next.join(", ")}</p>` : ""}
      <a class="more" href="${teamUrl(t)}">Full season and schedule →</a>
    </div>`;
  }

  const DIV_ORDER = ["Atlantic", "North", "Central", "Pacific"];
  const CONF_ORDER = ["Eastern", "Western"];
  const sortKeys = (obj, order) => Object.keys(obj).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));

  const weekLegend = () => state.week ? `<span class="arrows"><span class="up">▲</span><span class="down">▼</span> Places moved during last week's games (${weekRange(state.week)}). Tap a team for details.</span>` : "";

  function renderDivision() {
    const { divisions, conferences } = state.st;
    const legend = `<div class="legend"><span class="b">First-round bye</span><span class="r">Playoff cutoff</span>${weekLegend()}</div>`;
    return legend + sortKeys(divisions, DIV_ORDER).map((d) => {
      const list = divisions[d];
      const conf = list[0].conf;
      return `<section class="group"><h3>${esc(d)} Division <small>${esc(conf)} Conference, top ${list[0].spots} make the playoffs</small></h3>${table(list, { lines: true })}</section>`;
    }).join("");
  }

  function renderConference() {
    const { conferences } = state.st;
    return sortKeys(conferences, CONF_ORDER).map((c) =>
      `<section class="group"><h3>${esc(c)} Conference</h3>${table(conferences[c], { showDiv: true, rankKey: "confRank" })}</section>`
    ).join("").replace(/^/, `<div class="legend">${weekLegend()}</div>`) + `<p class="note">Playoff spots are decided within each division, so conference rank shows who's strongest rather than who's in.</p>`;
  }

  function renderLeague() {
    return `<div class="legend">${weekLegend()}</div><section class="group"><h3>Whole league <small>All ${state.st.league.length} teams by points percentage</small></h3>${table(state.st.league, { showDiv: true, rankKey: "leagueRank" })}</section>`;
  }

  function renderOdds() {
    if (!state.odds) return `<div class="msg">Running 5,000 simulated seasons…</div>`;
    const list = state.st.teams.slice().sort((a, b) => {
      const A = state.odds.byId.get(a.id), B = state.odds.byId.get(b.id);
      return B.playoffs - A.playoffs || B.projPts - A.projPts;
    });
    const rows = list.map((t, i) => {
      const o = state.odds.byId.get(t.id);
      const row = `<td class="rank">${i + 1}</td><td class="mv">${state.week ? move(weekVal(t, "dOdds"), "pts") : ""}</td>${teamCell(t, true)}
        <td>${t.w}-${t.l}-${t.otl}-${t.sol}</td><td>${t.remaining}</td>
        <td>${Math.round(o.projPts)}</td><td>${pct(o.projPct)}</td>
        <td>${oddsCell(o.divTitle)}</td><td>${oddsCell(o.bye)}</td><td>${oddsCell(o.playoffs)}</td>`;
      return withDetail(t, row, 10, "");
    }).join("");
    return `<section class="group"><h3>Playoff odds <small>${state.odds.gamesLeft} games left to play</small></h3>${state.week ? `<div class="legend"><span class="arrows">Arrows show how much each team's playoff odds moved during last week's games (${weekRange(state.week)}), in percentage points.</span></div>` : ""}
      <div class="scroll"><table><thead><tr><th class="rank" scope="col">#</th><th class="mv" scope="col"><span class="sr">Odds change last week</span></th><th class="team" scope="col">Team</th>
      <th scope="col" title="W-L-OTL-SOL">Record</th><th scope="col">Games left</th>
      <th scope="col" title="Projected final points">Proj PTS</th><th scope="col">Proj PCT</th>
      <th scope="col">Win division</th><th scope="col" title="Skip the best-of-three first round">Bye</th><th scope="col">Make playoffs</th></tr></thead>
      <tbody>${rows}</tbody></table></div></section>`;
  }


  // ---- Trends: week-by-week line chart ----
  const METRICS = {
    divRank: { label: "Division rank", rank: true },
    confRank: { label: "Conference rank", rank: true },
    leagueRank: { label: "League rank", rank: true },
    pts: { label: "Points" },
    pct: { label: "Points %" },
    odds: { label: "Playoff odds" },
  };
  const PALETTE = ["#2F6FD6", "#E8590C", "#2F9E44", "#AE3EC9", "#D6336C", "#0C8599", "#B5891A", "#6741D9", "#7C8B99", "#8D5A3B",
                   "#1098AD", "#F08C00", "#5C940D", "#C2255C", "#3B5BDB", "#9C36B5", "#E67700"];
  state.trend = { metric: store.get("tMetric") || "divRank", group: store.get("tGroup") || "", focus: null, weeks: null, odds: null, members: [] };

  function trendGroup() {
    const T = state.trend;
    if (T.group) return T.group;
    const fav = state.fav && state.st.byId.get(state.fav);
    return `div:${fav ? fav.div : "Atlantic"}`;
  }

  function renderTrends() {
    const T = state.trend;
    if (!T.weeks) T.weeks = AHL.weekSeries(state.data);
    const group = trendGroup();
    const [kind, name] = group.split(":");
    const rankKey = kind === "div" ? "divRank" : "confRank";
    T.members = state.st.teams.filter((t) => (kind === "div" ? t.div === name : t.conf === name)).sort((a, b) => a[rankKey] - b[rankKey]);
    const opt = (v, label, cur) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
    const groups = [...sortKeys(state.st.divisions, DIV_ORDER).map((d) => [`div:${d}`, `${d} Division`]),
                    ...sortKeys(state.st.conferences, CONF_ORDER).map((c) => [`conf:${c}`, `${c} Conference`])];
    const controls = `<div class="trend-controls">
      <label>Show <select id="tMetric">${Object.entries(METRICS).map(([k, m]) => opt(k, m.label, T.metric)).join("")}</select></label>
      <label>Teams <select id="tGroup">${groups.map(([v, l]) => opt(v, l, group)).join("")}</select></label></div>`;
    if (!T.weeks.length) return controls + `<div class="msg">The chart starts once the first week of the season is finished. A new week is added every Monday morning.</div>`;
    if (T.metric === "odds" && !T.odds) {
      setTimeout(() => { T.odds = T.weeks.map((w) => AHL.weekOdds(w, 1000)); render(); }, 30);
      return controls + `<div class="msg">Working out the playoff odds for each week…</div>`;
    }
    return controls + `<div class="chart-wrap" id="chart"></div>
      <p class="chart-note">Each point shows where things stood after that week's Sunday games. Weeks start on Monday, and a new one is added every Monday at 3 a.m. Pacific. Tap a line or team name to highlight it.</p>`;
  }

  function fmtMetric(metric, v) {
    if (v === null || v === undefined) return "–";
    if (METRICS[metric].rank) return ord(v);
    if (metric === "pct") return pct(v);
    if (metric === "odds") return v >= 0.995 && v < 1 ? ">99%" : v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`;
    return String(v);
  }

  function niceStep(range, target) {
    const raw = range / target, mag = 10 ** Math.floor(Math.log10(raw)), f = raw / mag;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  }

  function drawChart() {
    const el = $("#chart");
    if (!el) return;
    const T = state.trend, weeks = T.weeks, metric = T.metric, M = METRICS[metric], members = T.members;
    const W = Math.floor(el.clientWidth), small = W < 560;
    const value = (i, t) => {
      if (metric === "odds") return T.odds[i].get(t.id).playoffs;
      const r = weeks[i].st.byId.get(t.id);
      if (metric === "pct") return r.gp ? r.pct : null;
      return r[metric];
    };
    const series = members.map((t, k) => ({ t, color: PALETTE[k % PALETTE.length], v: weeks.map((_, i) => value(i, t)) }));
    const all = series.flatMap((s) => s.v).filter((v) => v !== null);

    let lo, hi, ticks;
    if (M.rank) {
      lo = 1; hi = Math.max(2, ...all);
      const step = hi <= 12 ? 1 : hi <= 20 ? 2 : 4;
      ticks = []; for (let r = 1; r <= hi; r += step) ticks.push(r);
    } else if (metric === "odds") {
      lo = 0; hi = 1; ticks = [0, 0.25, 0.5, 0.75, 1];
    } else if (metric === "pct") {
      lo = Math.max(0, Math.floor((Math.min(...all) - 0.02) * 10) / 10); hi = Math.min(1, Math.ceil((Math.max(...all) + 0.02) * 10) / 10);
      ticks = []; for (let v = lo; v <= hi + 1e-9; v += 0.1) ticks.push(Math.round(v * 10) / 10);
    } else {
      lo = 0; const step = niceStep(Math.max(...all, 4), 5); hi = Math.ceil(Math.max(...all, 4) / step) * step;
      ticks = []; for (let v = 0; v <= hi; v += step) ticks.push(v);
    }

    const m = { l: small ? 34 : 48, r: small ? 104 : 136, t: 16, b: 46 };
    const rows = M.rank ? hi : 8;
    const H = Math.max(small ? 300 : 360, M.rank ? rows * (small ? 24 : 28) + m.t + m.b : members.length * (small ? 20 : 24) + m.t + m.b);
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const x = (i) => (weeks.length === 1 ? m.l + iw / 2 : m.l + (i / (weeks.length - 1)) * iw);
    const y = (v) => (M.rank ? m.t + ((v - 1) / (hi - 1)) * ih : m.t + ih - ((v - lo) / (hi - lo)) * ih);

    const grid = ticks.map((v) => `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(v)}" y2="${y(v)}" class="grid"/>
      <text x="${m.l - 8}" y="${y(v)}" class="ytick">${M.rank ? v : metric === "odds" ? `${v * 100}%` : metric === "pct" ? pct(v) : v}</text>`).join("");
    const every = Math.ceil(weeks.length / Math.max(1, Math.floor(iw / (small ? 26 : 34))));
    const xt = weeks.map((w, i) => ((weeks.length - 1 - i) % every === 0 ? `<text x="${x(i)}" y="${m.t + ih + 20}" class="xtick">${w.n}</text>` : "")).join("");

    let cut = "";
    if (metric === "divRank" && trendGroup().startsWith("div:") && members.length) {
      const { spots, byes } = members[0];
      const line = (r, cls) => (r < hi ? `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(r + 0.5)}" y2="${y(r + 0.5)}" class="${cls}"/>` : "");
      cut = line(byes, "cut-blue") + line(spots, "cut-red");
    }
    if (metric === "odds") cut = `<line x1="${m.l}" x2="${m.l + iw}" y1="${y(0.5)}" y2="${y(0.5)}" class="half"/>`;

    const focus = T.focus;
    const lines = series.map((s) => {
      let d = "", pen = false;
      s.v.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = true; });
      const isFav = s.t.id === state.fav, on = !focus || focus === s.t.id;
      const w = focus === s.t.id || (isFav && !focus) ? 4 : 2.25;
      const dots = s.v.map((v, i) => (v === null ? "" : `<circle cx="${x(i)}" cy="${y(v)}" r="${weeks.length > 20 ? 2 : 3.2}" fill="${s.color}"/>`)).join("");
      return `<g class="series${on ? "" : " dim"}" data-team="${esc(s.t.id)}" style="color:${s.color}">
        <path d="${d}" fill="none" stroke="${s.color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>${dots}
        <path d="${d}" class="hit"/></g>`;
    });
    // Put the favorite and focused team on top.
    const order = series.map((s, i) => i).sort((a, b) => (series[a].t.id === (focus || state.fav)) - (series[b].t.id === (focus || state.fav)));

    // Team names at the end of each line, nudged apart so they don't overlap.
    const gap = small ? 13 : 15;
    const labels = series.map((s) => {
      let i = s.v.length - 1; while (i >= 0 && s.v[i] === null) i--;
      return { s, y0: i >= 0 ? y(s.v[i]) : m.t + ih, y: i >= 0 ? y(s.v[i]) : m.t + ih };
    }).sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, labels[i - 1].y + gap);
    const maxY = m.t + ih + 4;
    if (labels.length && labels[labels.length - 1].y > maxY) {
      labels[labels.length - 1].y = maxY;
      for (let i = labels.length - 2; i >= 0; i--) labels[i].y = Math.min(labels[i].y, labels[i + 1].y - gap);
    }
    const lx = m.l + iw + 8;
    const labelSvg = labels.map(({ s, y0, y: ly }) => {
      const on = !focus || focus === s.t.id, strong = s.t.id === state.fav || focus === s.t.id;
      return `<g class="label${on ? "" : " dim"}" data-team="${esc(s.t.id)}">
        <path d="M${m.l + iw + 2},${y0} L${lx},${ly}" stroke="${s.color}" stroke-width="1" fill="none"/>
        <text x="${lx + 4}" y="${ly}" fill="${s.color}" class="${strong ? "strong" : ""}">${esc(s.t.nickname || s.t.name)}</text></g>`;
    }).join("");

    el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="chart${small ? " small" : ""}" role="img" aria-label="${esc(M.label)} by week for ${esc(trendGroup().split(":")[1])}">
      ${grid}${cut}${xt}<text x="${m.l + iw / 2}" y="${H - 6}" class="xtitle">Week</text>
      <line id="guide" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" class="guide" visibility="hidden"/>
      ${order.map((i) => lines[i]).join("")}${labelSvg}</svg><div class="tip${small ? " below" : ""}" id="tip" hidden></div>`;

    const svg = el.querySelector("svg"), guide = el.querySelector("#guide"), tip = el.querySelector("#tip");
    const show = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const px = clientX - rect.left;
      if (px < m.l - 10 || px > m.l + iw + 10) { guide.setAttribute("visibility", "hidden"); tip.hidden = true; return; }
      const i = weeks.length === 1 ? 0 : Math.max(0, Math.min(weeks.length - 1, Math.round(((px - m.l) / iw) * (weeks.length - 1))));
      guide.setAttribute("x1", x(i)); guide.setAttribute("x2", x(i)); guide.setAttribute("visibility", "visible");
      const rowsHtml = series.filter((s) => s.v[i] !== null)
        .sort((a, b) => (M.rank ? a.v[i] - b.v[i] : b.v[i] - a.v[i]))
        .map((s) => `<li class="${s.t.id === state.fav || s.t.id === focus ? "strong" : ""}"><i style="background:${s.color}"></i>${esc(s.t.nickname || s.t.name)}<span>${fmtMetric(metric, s.v[i])}</span></li>`).join("");
      tip.innerHTML = `<p><b>Week ${weeks[i].n}</b>: week of ${shortDay(weeks[i].start)}</p><ul>${rowsHtml}</ul>`;
      tip.hidden = false;
      if (small) return; // on phones the details sit below the chart instead of over it
      const tw = tip.offsetWidth;
      tip.style.left = `${x(i) + 14 + tw > W ? Math.max(0, x(i) - 14 - tw) : x(i) + 14}px`;
      tip.style.top = `${m.t}px`;
    };
    svg.addEventListener("pointermove", (e) => show(e.clientX));
    svg.addEventListener("pointerdown", (e) => show(e.clientX));
    svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { guide.setAttribute("visibility", "hidden"); tip.hidden = true; } });
    svg.addEventListener("click", (e) => {
      const g = e.target.closest("[data-team]");
      if (!g) return;
      T.focus = T.focus === g.dataset.team ? null : g.dataset.team;
      drawChart();
    });
  }

  // ---- Team page: every game this season, plus what's left ----
  function renderTeam() {
    const t = state.teamId && state.st.byId.get(state.teamId);
    if (!t) return `<div class="msg">Choose a team from the list above to see its season.</div>`;
    const IDX = { W: 0, L: 1, OTL: 2, SOL: 3 };
    const run = [0, 0, 0, 0], split = { home: [0, 0, 0, 0], away: [0, 0, 0, 0] };
    const oppCell = (x) => `<td class="opp"><a href="${teamUrl(x.opp)}">${logoBox(x.opp)}<span>${x.home ? "vs" : "at"} ${esc(x.opp.nickname || x.opp.name)}</span></a></td>`;
    const games = teamGames(t.id);
    const played = games.filter((g) => g[5]).map((g) => {
      const x = result(t, g);
      run[IDX[x.res]]++; split[x.home ? "home" : "away"][IDX[x.res]]++;
      const pts = x.res === "W" ? 2 : x.res === "L" ? 0 : 1;
      return `<tr><td class="date">${day(g[0])}</td>${oppCell(x)}<td class="res"><span class="${x.res === "W" ? "W" : "L"}">${x.res}</span></td>
        <td>${x.us}–${x.them}${x.extra}</td><td class="pts">${pts}</td><td>${run.join("-")}</td></tr>`;
    }).reverse().join(""); // newest first
    const left = games.filter((g) => !g[5]).map((g) => `<tr><td class="date">${day(g[0])}</td>${oppCell(result(t, g))}</tr>`).join("");
    const head = (cols) => `<thead><tr>${cols.map(([label, cls, title]) => `<th scope="col" class="${cls || ""}"${title ? ` title="${title}"` : ""}>${label}</th>`).join("")}</tr></thead>`;
    return `<section class="group"><h3>Results <small>Home ${split.home.join("-")}, road ${split.away.join("-")}</small></h3>
      ${played ? `<div class="scroll"><table class="games">${head([["Date", "date"], ["Opponent", "opp"], ["Result", "res"], ["Score"], ["PTS", "", "Points earned"], ["Record", "", "Season record after this game: W-L-OTL-SOL"]])}<tbody>${played}</tbody></table></div>
      <p class="note">Newest first. A win earns 2 points; an overtime (OTL) or shootout (SOL) loss still earns 1. Records are W-L-OTL-SOL.</p>` : `<div class="msg">No games played yet.</div>`}</section>
      <section class="group"><h3>Still to play <small>${t.remaining} game${t.remaining === 1 ? "" : "s"}</small></h3>
      ${left ? `<div class="scroll"><table class="games">${head([["Date", "date"], ["Opponent", "opp"]])}<tbody>${left}</tbody></table></div>` : `<div class="msg">Regular season complete.</div>`}</section>`;
  }

  function renderFav() {
    const panel = $("#favPanel");
    const id = state.view === "team" ? state.teamId : state.fav;
    const t = id && state.st && state.st.byId.get(id);
    if (!t) { panel.hidden = true; return; }
    const o = state.odds && state.odds.byId.get(t.id);
    const games = state.data.games;
    const name = (id) => state.st.byId.get(id).name;
    let last = null, next = null;
    for (const g of games) {
      if (g[1] !== t.id && g[2] !== t.id) continue;
      if (g[5]) last = g; else if (!next) next = g;
    }
    const describe = (g) => {
      const home = g[1] === t.id;
      const opp = name(home ? g[2] : g[1]);
      if (!g[5]) return `${day(g[0])} ${home ? "vs" : "at"} ${esc(opp)}`;
      const us = home ? g[3] : g[4], them = home ? g[4] : g[3];
      const res = us > them ? "W" : "L";
      const extra = g[5] === 2 ? " OT" : g[5] === 3 ? " SO" : "";
      return `<span class="${res}">${res}</span> ${us}–${them}${extra} ${home ? "vs" : "at"} ${esc(opp)}`;
    };
    const odds = o ? (state.odds.gamesLeft ? (o.playoffs >= 0.995 ? ">99%" : o.playoffs < 0.005 && o.playoffs > 0 ? "<1%" : `${Math.round(o.playoffs * 100)}%`) : o.playoffs > 0.5 ? "In" : "Out") : "…";
    panel.innerHTML = `${logoBox(t, "big")}
      <h2>${esc(t.name)}</h2>
      <div class="line">${ord(t.divRank)} in the ${esc(t.div)} Division, ${ord(t.confRank)} in the ${esc(t.conf)} Conference, ${ord(t.leagueRank)} in the league</div>
      <div class="stats">
        <div class="stat"><b>${t.w}-${t.l}-${t.otl}-${t.sol}</b><span>Record</span></div>
        <div class="stat"><b>${t.pts}</b><span>Points</span></div>
        <div class="stat"><b>${t.gp ? pct(t.pct) : "–"}</b><span>Points %</span></div>
        <div class="stat"><b>${odds}</b><span>Playoff odds</span></div>
        ${state.week ? (() => { const x = state.week.byId.get(t.id); return `<div class="stat"><b>${x.games.length ? `${x.record.join("-")}` : "Off"} <span class="fav-mv">${move(x.dDiv)}</span></b><span>Last week</span></div>`; })() : ""}
        <div class="stat wide"><b style="font-size:1.1rem">${last ? describe(last) : "No games yet"}</b><span>Last game</span></div>
        <div class="stat wide"><b style="font-size:1.1rem">${next ? describe(next) : "Season complete"}</b><span>Next game</span></div>
      </div>${state.view === "team" ? "" : `<a class="more" href="${teamUrl(t)}">Full season and schedule →</a>`}`;
    panel.hidden = false;
  }

  function render() {
    if (!state.st) return;
    const views = { division: renderDivision, conference: renderConference, league: renderLeague, odds: renderOdds, trends: renderTrends, team: renderTeam };
    const scrollPos = [...document.querySelectorAll(".scroll")].map((el) => el.scrollLeft); // keep sideways scroll across redraws
    $("#main").innerHTML = (views[state.view] || renderDivision)();
    document.querySelectorAll(".scroll").forEach((el, i) => { if (scrollPos[i]) el.scrollLeft = scrollPos[i]; });
    if (state.view === "trends") drawChart();
    document.querySelectorAll(".scroll").forEach((el) => {
      const mark = () => el.classList.toggle("scrolled", el.scrollLeft > 2);
      el.addEventListener("scroll", mark, { passive: true });
      mark();
    });
    renderFav();
  }

  function fillPicker() {
    const sel = $("#fav");
    const sorted = state.st.teams.slice().sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">Choose a team</option>` + sorted.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("");
    const id = state.view === "team" ? state.teamId : state.fav;
    sel.value = state.st.byId.has(id) ? id : "";
  }

  $("#main").addEventListener("click", (e) => {
    const b = e.target.closest("button.expand");
    if (!b) return;
    const id = b.dataset.team;
    state.open.has(id) ? state.open.delete(id) : state.open.add(id);
    render();
    const again = document.querySelector(`button.expand[data-team="${CSS.escape(id)}"]`);
    if (again) again.focus({ preventScroll: true });
  });
  $("#main").addEventListener("change", (e) => {
    if (e.target.id === "tMetric") { state.trend.metric = e.target.value; store.set("tMetric", e.target.value); }
    else if (e.target.id === "tGroup") { state.trend.group = e.target.value; store.set("tGroup", e.target.value); state.trend.focus = null; }
    else return;
    render();
  });
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => state.view === "trends" && drawChart(), 150); });
  $("#fav").addEventListener("change", (e) => {
    // On a team page the picker switches teams instead of setting your favorite.
    if (state.view === "team") { const t = state.st.byId.get(e.target.value); if (t) location.href = teamUrl(t); return; }
    state.fav = e.target.value; store.set("fav", state.fav); render();
  });

  async function load() {
    try {
      const res = await fetch("/api/data");
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      state.data = data;
      state.st = AHL.computeStandings(data);
      if (state.view === "team") {
        const name = decodeURIComponent(location.pathname.split("/")[2] || "");
        const t = state.st.teams.find((x) => slug(x) === name);
        state.teamId = t ? t.id : "";
        if (t) document.title = `${t.name}: AHL standings`;
      }
      const when = new Date(data.updatedAt).toLocaleString(undefined, { timeZone: "America/Los_Angeles", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      $("#updated").textContent = `${data.season.name}. Updated ${when} Pacific.`;
      fillPicker();
      render();
      setTimeout(() => {
        state.odds = AHL.simulate(data, state.st, 5000); render();
        setTimeout(() => { state.week = AHL.weekly(data, 2000); render(); }, 30);
      }, 30);
    } catch (err) {
      $("#updated").textContent = "Standings couldn't be loaded.";
      $("#main").innerHTML = `<div class="msg error"><b>The stats feed didn't respond.</b> ${esc(err.message)}. Reload in a minute; if it keeps happening, check /api/status.</div>`;
    }
  }
  load();
})();
