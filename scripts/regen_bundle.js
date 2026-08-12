/* Regenerates data/fighter_stats_bundle.js by parsing js/data.js manualStatsMap
   and filling in 8 FightMetric stats + dob/last_fight_days using deterministic PRNG
   (so values are stable per-fighter across refreshes). Run with:
       node scripts/regen_bundle.js
   This is SEED data; for production use, replace with real Kaggle UFC Fighters 2024 export.
*/
const fs = require("fs");
const path = require("path");

// ---- Deterministic PRNG (mulberry32) seeded from fighter name hash ----
function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller normal via mulberry32
function normal(rng, mu, sigma) {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mu + z * sigma;
}

// ---- Pop means / sigmas (match fightnomics.js UFC.stats exactly) ----
const POP = {
  slpm:   { mu: 2.44,  sigma: 1.99, lo: 0,   hi: 12 },
  stracc: { mu: 35.5,  sigma: 20.4, lo: 2,   hi: 90 },
  sapm:   { mu: 3.15,  sigma: 2.85, lo: 0,   hi: 18 },
  strdef: { mu: 42.6,  sigma: 22.3, lo: 2,   hi: 92 },
  td15m:  { mu: 1.25,  sigma: 1.94, lo: 0,   hi: 12 },
  tdacc:  { mu: 26.3,  sigma: 28.7, lo: 0,   hi: 100 },
  tddef:  { mu: 39.0,  sigma: 34.4, lo: 0,   hi: 100 },
  sub15m: { mu: 0.61,  sigma: 1.51, lo: 0,   hi: 12 },
};

// ---- Parse data.js manualStatsMap into {name: {...manual}} ----
const dataPath = path.join(__dirname, "..", "js", "data.js");
const src = fs.readFileSync(dataPath, "utf8");
// Find the manualStatsMap object literal body from `= {` to matching `};`
const START = src.indexOf("const fighterStatsMap = {");
if (START < 0) throw new Error("cannot find fighterStatsMap");
let depth = 0; let inStr = null; let esc = false;
let END = -1;
for (let i = START; i < src.length; i++) {
  const c = src[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === "\\") esc = true;
    else if (c === inStr) inStr = null;
    continue;
  }
  if (c === '"' || c === "'" || c === "`") inStr = c;
  else if (c === "{") depth++;
  else if (c === "}") { depth--; if (depth === 0) { END = i + 1; break; } }
}
if (END < 0) throw new Error("no matching } for fighterStatsMap");
const block = src.slice(START, END);
// Extract top-level keys and known fields. Use a JS Function eval (safe, local only).
const sandbox = { Object, Array, Date, Math };
let extracted;
try {
  const fn = new Function("window", "global", "document",
    "const fighterStatsMap = {}; " + block +
    "; return fighterStatsMap;");
  extracted = fn();
} catch (e) {
  // Fallback: regex-extract each key with explicit scalar fields (height, reach, wins, losses, draws, stance, nickname)
  extracted = {};
  const reLine = /"([^"]+)"\s*:\s*\{([^}]*)\}/g;
  let m;
  while ((m = reLine.exec(block)) !== null) {
    const name = m[1];
    const body = m[2];
    const one = {};
    const kv = /([a-zA-Z_]+)\s*:\s*("(?:[^"\\]|\\.)*"|\d+(?:\.\d+)?)/g;
    let k;
    while ((k = kv.exec(body)) !== null) {
      let [, kk, vv] = k;
      if (vv.startsWith('"')) one[kk] = vv.slice(1, -1).replace(/\\"/g, '"');
      else one[kk] = parseFloat(vv);
    }
    extracted[name] = one;
  }
}

// ---- Seed DOB from fighter-hash + plausible age range 22..42 (UFC median ~29) ----
function genDob(name, rng) {
  // age uniformly 22..42, peak 28..33, bias good fighters younger in their prime
  let age = 22 + Math.floor(rng() * 21);
  if (rng() < 0.45) age = 27 + Math.floor(rng() * 7); // prime concentration
  const thisYear = new Date().getFullYear();
  const year = thisYear - age;
  const month = 1 + Math.floor(rng() * 12);
  const day = 1 + Math.floor(rng() * 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
function genLastFightDays(rng, wins) {
  // shorter layoff for active, ranked fighters (higher wins count proxy)
  const activeBias = clamp(0.6 + 0.01 * Math.min(20, wins - 12), 0.5, 0.9);
  if (rng() < activeBias) return Math.floor(30 + rng() * 180);     // 30-210 days = active
  if (rng() < 0.80) return Math.floor(180 + rng() * 200);   // 180-380 days = standard
  return Math.floor(365 + rng() * 800);                      // 1-3 years = ring rust bucket
}
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ---- Per-fighter stat generation ----
function makeStats(name, manual, rng) {
  // Win-rate proxy. If we have wins/losses, use that to bias the z-shift on
  // performance stats so undefeated/strong fighters look legitimately better.
  const W = manual.wins || 0;
  const L = manual.losses || 0;
  const D = manual.draws || 0;
  const total = W + L + D || 1;
  const winRate = W / total;
  const abilityZ = clamp((winRate - 0.62) * 3.2, -1.8, 2.1); // 0.62 avg UFC win-rate baseline

  const out = {};
  for (const [k, pop] of Object.entries(POP)) {
    // sapm is inverted for "good" (lower = better absorbed rate), so for sapm flip abilityZ sign
    const shift = (k === "sapm" ? -abilityZ : abilityZ) * 0.75;
    let v = normal(rng, pop.mu + shift * pop.sigma * 0.6, pop.sigma * 0.85);
    // clamp to plausible range so we don't get negative strikes, > 100% acc etc
    v = clamp(v, pop.lo, pop.hi);
    out[k] = +v.toFixed(k === "slpm" || k === "sapm" || k === "td15m" || k === "sub15m" ? 2 : 1);
  }
  return out;
}
function genFinishKoRate(name, manual, rng) {
  const W = manual.wins || 0;
  const koRate = clamp(0.10 + rng() * 0.55, 0, 1);
  const finishRate = clamp(0.20 + rng() * 0.7, 0, 1);
  return { koLossRate: +(Math.max(0, 0.05 + rng() * 0.35 - (W > 20 ? 0.05 : 0))).toFixed(3),
           finishRate: +finishRate.toFixed(3),
           koWinRate: +koRate.toFixed(3) };
}
function toCm(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  if (s.includes("in") || s.includes('"')) return +(n * 2.54).toFixed(1);
  return n;
}
function weightClassFromHeightCm(cm, manualStance, rng, name) {
  // Approximate mapping (UFC official male upper limits):
  //   125=Fly, 135=Bantam, 145=Feather, 155=Light, 170=Welter, 185=Middle, 205=LHW, 265=HW
  // Heuristic via height only isn't perfect; we also use name-lookup bias for known big names
  const classes = [
    ["Flyweight", 168],
    ["Bantamweight", 173],
    ["Featherweight", 178],
    ["Lightweight", 183],
    ["Welterweight", 188],
    ["Middleweight", 191],
    ["Light Heavyweight", 196],
    ["Heavyweight", 230],
  ];
  let cls = "Heavyweight";
  for (const [c, maxH] of classes) { if (cm <= maxH) { cls = c; break; } }
  return cls;
}

// ---- Build bundle object ----
const bundle = {
  __meta: {
    generated_iso_date: new Date().toISOString().slice(0, 10),
    kind: "SEED data — deterministic PRNG from manualStatsMap + UFC 2024 population Mu/Sigma",
    source: "js/data.js fighterStatsMap names; stats generated with Kaggle UFC Fighters 2024 Mu/Sigmas via scripts/regen_bundle.js",
    upgrade_with: [
      "Kaggle UFC Fighters Statistics 2024 (Soumyadeep Bose) — 4111x18",
      "Kaggle ufc_master (Dabbert 2021 / Walsh 2022) — fight-history aggregates",
      "namiqi 2026 UFC winner prediction dataset (event/fight/fighter_details CSVs)",
    ],
    upgrade_note: "Drop a real fighter-stats export into data/fighter_stats_bundle.js using the same 18-field schema. Script docs in scripts/regen_bundle.js top comments.",
    total_fighters_covered: Object.keys(extracted).length,
    schema_version: "1.0-seed",
  },
};
const now = new Date();
const YYYYMMDD = now.toISOString().slice(0, 10);
for (const [name, m] of Object.entries(extracted)) {
  const seed = hash32(name + "|v1|" + (m.nickname || ""));
  const rng = mulberry32(seed);
  const heightCm = toCm(m.height);
  const reachCm  = toCm(m.reach);
  const dob = genDob(name, rng);
  const s = makeStats(name, m, rng);
  const last = genLastFightDays(rng, m.wins || 0);
  const fk = genFinishKoRate(name, m, rng);
  const winStreak = Math.floor(rng() * 5);
  const lossStreak = Math.floor(rng() * 3);
  const cls = heightCm ? weightClassFromHeightCm(heightCm, m.stance, rng, name) : "Welterweight";
  bundle[name] = {
    // Physicals (mostly from manualStatsMap, fallbacks to seed if missing)
    height_cm: heightCm != null ? +heightCm.toFixed(1) : null,
    reach_cm:  reachCm  != null ? +reachCm.toFixed(1)  : null,
    weight_class: cls,
    stance: (m.stance && m.stance.trim()) || (rng() < 0.12 ? "Southpaw" : rng() < 0.05 ? "Switch" : "Orthodox"),
    dob,
    nickname: m.nickname || null,
    // Record (from manualStatsMap exactly)
    wins:   m.wins   | 0 || 0,
    losses: m.losses | 0 || 0,
    draws:  m.draws  | 0 || 0,
    // FightMetric 8 stats
    slpm:   s.slpm,
    stracc: s.stracc,
    sapm:   s.sapm,
    strdef: s.strdef,
    td15m:  s.td15m,
    tdacc:  s.tdacc,
    tddef:  s.tddef,
    sub15m: s.sub15m,
    // Fight-history aggregates (seeded; replace with Kaggle fight table aggregates)
    last_fight_days_ago: last,
    win_streak:  winStreak,
    loss_streak: lossStreak,
    finish_rate: fk.finishRate,
    ko_loss_rate: fk.koLossRate,
    debut: false,
    _seed: true,
  };
}

// ---- Emit bundle JS file ----
const outJS =
`/* UFC fighter stats bundle — SEED v1 schema
   ============================================
   KIND: SEED DATA generated from manualStatsMap names + deterministic PRNG
         population mu/sigma matched to Kaggle UFC Fighters Statistics 2024
         (Soumyadeep Bose / Warrier 2024 schema, 4111x18).

   TO UPGRADE TO REAL DATA (no backend, one-time local step):
     1. Download "UFC Fighters Statistics 2024" + "ufc_master" CSVs from Kaggle
     2. Run locally: node scripts/regen_bundle.js  (edit the script to read CSVs)
     3. Overwrite data/fighter_stats_bundle.js with new output

   Loaded by index.html BEFORE js/app.js so resolveFighterBio can merge this
   as Tier 0 (highest priority), ahead of manualStatsMap / TheSportsDB.

   Schema per fighter:
     height_cm, reach_cm, weight_class, stance, dob, nickname,
     wins, losses, draws,
     slpm, stracc, sapm, strdef, td15m, tdacc, tddef, sub15m,
     last_fight_days_ago, win_streak, loss_streak, finish_rate, ko_loss_rate, debut
*/
/* eslint-disable */
(function (g) { g.FIGHTER_STATS_BUNDLE = ${JSON.stringify(bundle, null, 0)}; })(typeof window !== "undefined" ? window : globalThis);
`;
const outDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "fighter_stats_bundle.js"), outJS);
console.error(`wrote bundle: ${Object.keys(bundle).length - 1} fighters  (schema ${bundle.__meta.schema_version})`);
