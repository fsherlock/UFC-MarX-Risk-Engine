"use strict";
const express = require("express");
const router = express.Router();

/*
 * UFC schedule + odds proxy
 *
 * TWO MODES (auto-detect):
 *   1) LIVE (ODDS_API_KEY set)   — proxy https://odds-api.io v3 with 3-min in-memory cache + X-Cache header
 *        Provider: https://odds-api.io/  (user confirmed — DIFFERENT from the-odds-api.com v4)
 *        MMA sport slug: "mixed-martial-arts" (NOT "mma")
 *        Free tier bookmaker limit: 2 bookmakers. Default books: 1xbet, Stake
 *            (override with ODDS_API_BOOKMAKERS="1xbet,Stake" env)
 *            To change: odds-api.io free tier allows "upgrade bookmaker selection"; if you get
 *            "Access denied. You're allowed max 2 bookmakers. Allowed: X, Y"
 *            → update ODDS_API_BOOKMAKERS env to match the 2 books listed
 *   2) STUB (no API key)      — return static demo data (same as before)
 */

const CACHE_TTL_MS = 3 * 60 * 1000;
const cache = new Map();
function cacheGet(key) {
  const c = cache.get(key);
  if (!c) return null;
  if (Date.now() > c.expiresAt) { cache.delete(key); return null; }
  return c.data;
}
function cacheSet(key, data, ttl) {
  cache.set(key, { data, expiresAt: Date.now() + (ttl || CACHE_TTL_MS) });
}

const ODDS_API_BASE = "https://api.odds-api.io/v3";
const ODDS_API_SPORT = "mixed-martial-arts";

const DEMO_UPCOMING = [
  {
    id: "ufc-330",
    event: "UFC 330: Volkanovski vs Ilia Topuria 2",
    date: (() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString(); })(),
    venue: "T-Mobile Arena, Las Vegas NV",
    league: { slug: "ufc", name: "UFC" },
    fights: [
      { weight: "Featherweight", fighters: ["Alexander Volkanovski", "Ilia Topuria"] },
      { weight: "Light Heavyweight", fighters: ["Magomed Ankalaev", "Johnny Walker"] },
      { weight: "Women's Strawweight", fighters: ["Zhang Weili", "Yan Xiaonan"] }
    ]
  }
];
const DEMO_ODDS = {
  "ufc-330": {
    provider: "STUB_DEMO",
    eventId: "ufc-330",
    markets: [
      {
        weight: "Featherweight",
        fighters: ["Alexander Volkanovski", "Ilia Topuria"],
        books: [
          { book: "DraftKings", decOdds: [2.30, 1.65], american: ["+130", "-154"] },
          { book: "FanDuel",   decOdds: [2.28, 1.67], american: ["+128", "-149"] },
          { book: "Bet365",    decOdds: [2.32, 1.63], american: ["+132", "-156"] }
        ]
      }
    ]
  }
};

function decToAmerican(dec) {
  if (!isFinite(dec) || dec <= 1) return 0;
  if (dec >= 2.0) return Math.round((dec - 1) * 100);
  return Math.round(-100 / (dec - 1));
}
function americanToSignedString(am) {
  if (am > 0) return "+" + am;
  return String(am);
}
function toDec(s) {
  if (typeof s === "number") return s;
  if (typeof s === "string") { const n = parseFloat(s); return isFinite(n) ? n : 0; }
  return 0;
}

function getBookmakersEnv() {
  const s = process.env.ODDS_API_BOOKMAKERS;
  if (s && typeof s === "string" && s.trim().length) {
    const arr = s.split(",").map(x => x.trim()).filter(Boolean);
    if (arr.length) return arr.slice(0, 2);
  }
  return ["1xbet", "Stake"];
}
function buildBookmakersQuery() {
  return getBookmakersEnv().join(",");
}

async function fetchLiveUpcoming() {
  const key = process.env.ODDS_API_KEY;
  const provider = process.env.ODDS_API_PROVIDER || "odds-api.io";
  const url = ODDS_API_BASE + "/events?apiKey=" + encodeURIComponent(key) +
    "&sport=" + encodeURIComponent(ODDS_API_SPORT);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let errMsg = "Upstream HTTP " + res.status;
    try {
      const j = JSON.parse(txt);
      if (j && j.error) errMsg = "Upstream: " + j.error;
    } catch (_) { /* ignore */ }
    throw new Error(errMsg);
  }
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new Error("Upstream response not array");
  const byLeague = new Map();
  const eventsToProcess = arr.filter(e => e.status !== "settled").slice(0, 80);
  for (const e of eventsToProcess) {
    // Group by League Name + Date (Y-M-D) to separate different events in the same league
    const dateStr = e.date ? e.date.split('T')[0] : 'no-date';
    const leagueName = (e.league && e.league.name) || "MMA Event";
    const groupKey = `${leagueName}_${dateStr}`;

    if (!byLeague.has(groupKey)) {
      byLeague.set(groupKey, {
        id: groupKey,
        event: leagueName,
        date: e.date,
        venue: "TBD",
        league: { slug: groupKey, name: leagueName },
        _minDate: e.date,
        fights: []
      });
    }
    const card = byLeague.get(groupKey);
    if (e.date && (!card._minDate || e.date < card._minDate)) card._minDate = e.date;
    if (e.date && (!card.date || e.date > card.date)) card.date = e.date;
    card.fights.push({
      weight: "\u2014",
      fighters: [e.home, e.away].filter(Boolean),
      _eventId: e.id,
      _status: e.status,
      _date: e.date
    });
  }
  const events = [...byLeague.values()]
    .sort((a, b) => {
      const da = a._minDate || a.date || "";
      const db = b._minDate || b.date || "";
      if (da < db) return -1;
      if (da > db) return 1;
      return 0;
    })
    .map((c) => {
      const cc = Object.assign({}, c);
      delete cc._minDate;
      return cc;
    });
  return { provider, events, _bookmakers: getBookmakersEnv() };
}

async function fetchLiveOdds(eventId) {
  const key = process.env.ODDS_API_KEY;
  const provider = process.env.ODDS_API_PROVIDER || "odds-api.io";
  const books = buildBookmakersQuery();
  let bookmakerAllowedInfo = null;
  const tryFetch = async function(bm) {
    let url = ODDS_API_BASE + "/odds?apiKey=" + encodeURIComponent(key) +
      "&eventId=" + encodeURIComponent(eventId);
    if (bm) url += "&bookmakers=" + encodeURIComponent(bm);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const txt = await res.text().catch(() => "");
    let json = null;
    try { if (txt) json = JSON.parse(txt); } catch (_) { /* ignore */ }
    if (!res.ok) {
      const msg = (json && json.error) ? json.error : ("Upstream HTTP " + res.status);
      return { err: msg, json: null, txt: txt };
    }
    return { err: null, json: json, txt: txt };
  };
  let att = await tryFetch(books);
  if (att.err && /Access denied.*allowed max 2 bookmakers.*Allowed:/.test(att.err || "")) {
    const mm = att.err.match(/Allowed:\s*([^.]+)/);
    if (mm && mm[1]) {
      const allowed = mm[1].split(",").map(x => x.trim()).filter(Boolean).slice(0, 2);
      bookmakerAllowedInfo = allowed;
      if (allowed.length) att = await tryFetch(allowed.join(","));
    }
  }
  if (att.err) throw new Error(att.err);
  const e = att.json;
  if (!e) throw new Error("Empty response");
  const fighters = [e.home, e.away].filter(Boolean);
  const booksMap = e.bookmakers || {};
  const outBooks = [];
  const _noteParts = [];
  if (bookmakerAllowedInfo) {
    _noteParts.push("bookmaker selection reset to tier-allowed: " + bookmakerAllowedInfo.join(","));
  }
  for (const bname of Object.keys(booksMap)) {
    const bm = booksMap[bname];
    if (!Array.isArray(bm)) continue;
    let ml = null;
    for (const m of bm) {
      const nm = (m && m.name) ? String(m.name).toUpperCase() : "";
      if (nm === "ML" || nm === "1N2" || nm === "1X2" || nm === "MONEYLINE") { ml = m; break; }
    }
    const market = ml || bm[0];
    if (!market || !Array.isArray(market.odds) || !market.odds.length) continue;
    const line0 = market.odds[0];
    let decA = 0, decB = 0;
    if (line0 && typeof line0 === "object" && line0 !== null) {
      decA = toDec(line0.home);
      decB = toDec(line0.away);
    }
    if (decA < 1.01 || decB < 1.01) continue;
    outBooks.push({
      book: bname,
      decOdds: [decA, decB],
      american: [
        americanToSignedString(decToAmerican(decA)),
        americanToSignedString(decToAmerican(decB))
      ]
    });
  }
  let note = "";
  if (_noteParts.length) note = _noteParts.join(" | ");
  else if (!outBooks.length) note = "No odds posted for this event yet (bookmakers not live close to fight)";
  const marketsOut = [];
  if (fighters.length === 2) {
    marketsOut.push({ weight: "\u2014", fighters: fighters, books: outBooks });
  }
  const out = { provider, eventId, markets: marketsOut };
  if (note) out._note = note;
  return out;
}

router.get("/upcoming", async (req, res) => {
  const key = process.env.ODDS_API_KEY;
  const provider = process.env.ODDS_API_PROVIDER || "STUB_DEMO";
  if (!key) {
    res.setHeader("X-Cache", "STUB");
    return res.json({
      provider,
      events: DEMO_UPCOMING,
      _note: "STUB DATA. Paste ODDS_API_KEY + ODDS_API_PROVIDER in backend/.env for live lines."
    });
  }
  try {
    const cached = cacheGet("upcoming");
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }
    const data = await fetchLiveUpcoming();
    cacheSet("upcoming", data);
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (err) {
    console.warn("ODDS /upcoming live fetch failed, fallback to STUB:", err.message);
    res.setHeader("X-Cache", "FALLBACK-STUB");
    res.json({
      provider,
      events: DEMO_UPCOMING,
      _note: "Live fetch failed (" + err.message + "). Fallback STUB demo data."
    });
  }
});

router.get("/odds/:eventId", async (req, res) => {
  const eventId = req.params.eventId;
  const key = process.env.ODDS_API_KEY;
  const provider = process.env.ODDS_API_PROVIDER || "STUB_DEMO";
  if (!key) {
    const stub = DEMO_ODDS[eventId] || { provider: "STUB_DEMO", eventId, markets: [] };
    res.setHeader("X-Cache", "STUB");
    return res.json(stub);
  }
  try {
    const cacheKey = "odds:" + eventId;
    const cached = cacheGet(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }
    if (DEMO_ODDS[eventId]) {
      cacheSet(cacheKey, DEMO_ODDS[eventId], 60 * 1000);
      res.setHeader("X-Cache", "DEMO");
      return res.json(DEMO_ODDS[eventId]);
    }
    const data = await fetchLiveOdds(eventId);
    cacheSet(cacheKey, data);
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (err) {
    console.warn("ODDS /odds/" + eventId + " live fetch failed, fallback to empty:", err.message);
    res.setHeader("X-Cache", "FALLBACK-EMPTY");
    res.json({ provider, eventId, markets: [], _note: "Live fetch failed (" + err.message + ")" });
  }
});

router.get("/config", (req, res) => {
  res.json({
    provider: process.env.ODDS_API_PROVIDER || "STUB_DEMO",
    hasKey: !!process.env.ODDS_API_KEY,
    bookmakers: getBookmakersEnv(),
    cacheTtlSec: Math.round(CACHE_TTL_MS / 1000),
    baseUrl: ODDS_API_BASE,
    sport: ODDS_API_SPORT
  });
});

module.exports = router;
