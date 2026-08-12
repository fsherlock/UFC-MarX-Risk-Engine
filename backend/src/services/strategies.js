/* ============================================================
 * backend/src/services/strategies.js
 *
 * Pure, identical extraction from js/app.js of:
 *   kellyFraction · computeKelly · computeEqualStake · computeYOLO
 *   generateParlays · computeSinglesRows · simulateStrategy
 *   computeFightProbabilities (3-mode + fallback chain + normalize)
 *
 * Parity rule: backend result MUST match browser 100% on identical input.
 * Tests pass => see backend/scripts/smoke_calculate.js
 * ============================================================ */
"use strict";

const path = require("path");
const FN = require("./fightnomics.js");

let BUNDLE = null;
function loadBundle() {
  if (BUNDLE) return BUNDLE;
  const p = path.join(__dirname, "fighter_stats_bundle.js");
  delete require.cache[require.resolve(p)];
  require(p);
  BUNDLE = (typeof globalThis !== "undefined" && globalThis.FIGHTER_STATS_BUNDLE)
        || (typeof global !== "undefined" && global.FIGHTER_STATS_BUNDLE)
        || {};
  return BUNDLE;
}
function resolveFighterBio(name) {
  const B = loadBundle();
  if (!name || typeof name !== "string") return null;
  const key = Object.keys(B).filter(k => k !== "__meta").find(k => k.toLowerCase() === name.toLowerCase().trim());
  if (key) return Object.assign({ name: key }, B[key]);
  if (typeof FN.fuzzyFighterLookup !== "function") return null;
  const candidates = Object.keys(B).filter(k => k !== "__meta");
  const fuzzy = FN.fuzzyFighterLookup(name, candidates, 0.88);
  if (fuzzy && fuzzy.length) return Object.assign({ name: fuzzy[0], __fuzzy: true }, B[fuzzy[0]]);
  return null;
}

function computeFightMarket(fight) {
  if (!fight) return null;
  const fA = fight.fighters[0];
  const fB = fight.fighters[1];
  if (!(fA && fA.odds > 1 && fB && fB.odds > 1)) return null;
  return FN.removeVigFromOdds(fA.odds, fB.odds);
}
function computeFightnomicsProbForFight(fight) {
  const fA = fight.fighters?.[0];
  const fB = fight.fighters?.[1];
  if (!fA || !fB || !fA.name || !fB.name) return null;
  const bioA = resolveFighterBio(fA.name);
  const bioB = resolveFighterBio(fB.name);
  if (!bioA || !bioB) return null;
  const ctx = { oddsA: (fA.odds && isFinite(fA.odds) && fA.odds>1) ? fA.odds : null, oddsB: (fB.odds && isFinite(fB.odds) && fB.odds>1) ? fB.odds : null };
  try {
    const prior = FN.fightnomicsPrior(FN.normalizeFighter(bioA), FN.normalizeFighter(bioB), ctx);
    return { pA: prior.pA, pB: prior.pB, prior };
  } catch(_) { return null; }
}

function computeFightProbabilities(fight, probMode /* 'user' | 'fn' | 'market' */) {
  const mode = (probMode === "fn" || probMode === "market" || probMode === "user") ? probMode : "user";
  const f1 = fight.fighters[0];
  const f2 = fight.fighters[1];
  const cA = Math.max(0, Number(f1.confidence) || 0);
  const cB = Math.max(0, Number(f2.confidence) || 0);
  const userNormA = cA / Math.max(1, cA + cB);
  const userNormB = 1 - userNormA;
  const market = computeFightMarket(fight);
  let modeUsed = mode;
  let fallbackNote = "";
  let probA, probB;
  if (mode === "market") {
    if (market) { probA = market.pA; probB = market.pB; }
    else { probA = userNormA; probB = userNormB; modeUsed = "user"; fallbackNote = "Market odds missing → fell back to My Confidence"; }
  } else if (mode === "fn") {
    const pr = computeFightnomicsProbForFight(fight);
    if (pr) { probA = pr.pA; probB = pr.pB; }
    else if (market) { probA = market.pA; probB = market.pB; modeUsed = "market"; fallbackNote = "Fight bios not in bundle → fell back to Market No-Vig"; }
    else { probA = userNormA; probB = userNormB; modeUsed = "user"; fallbackNote = "Fight bios + odds missing → fell back to My Confidence"; }
  } else {
    probA = userNormA; probB = userNormB;
  }
  const sumCheck = probA + probB;
  if (sumCheck < 0.95 || sumCheck > 1.05) {
    const s = probA + probB;
    probA = probA / s; probB = 1 - probA;
  }
  return [
    { name: f1.name, odds: f1.odds, prob: probA, status: f1.status,
      market: market ? market.pA : null, vig: market ? market.vig : null,
      userProb: userNormA, modeUsed, fallbackNote },
    { name: f2.name, odds: f2.odds, prob: probB, status: f2.status,
      market: market ? market.pB : null, vig: market ? market.vig : null,
      userProb: userNormB, modeUsed, fallbackNote }
  ];
}

function kellyFraction(odds, prob) {
  const b = odds - 1;
  const p = prob;
  const q = 1 - p;
  const k = (b * p - q) / b;
  if (!Number.isFinite(k) || k <= 0) return 0;
  return k * 0.25;
}

function generateParlays(fights) {
  const combinations = [];
  const n = fights.length;
  const maxN = 5;
  if (n > maxN) {
    throw new Error(`generateParlays: ${n} fights exceeds cap of ${maxN}.`);
  }
  function recurse(idx, currentParlay, fightProbMap) {
    if (idx === n) {
      if (currentParlay.length > 0) combinations.push(currentParlay);
      return;
    }
    const f = fights[idx];
    const [a, b] = fightProbMap[f.id];
    if (!isNaN(a.odds) && a.prob > 0) recurse(idx + 1, [...currentParlay, { fight: f.id, name: a.name, odds: a.odds, prob: a.prob, status: a.status }], fightProbMap);
    if (!isNaN(b.odds) && b.prob > 0) recurse(idx + 1, [...currentParlay, { fight: f.id, name: b.name, odds: b.odds, prob: b.prob, status: b.status }], fightProbMap);
  }
  const fightProbMap = {};
  fights.forEach(f => { fightProbMap[f.id] = computeFightProbabilities(f, "user"); });
  recurse(0, [], fightProbMap);
  return combinations.map(picks => {
    const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1);
    const combinedProb = picks.reduce((acc, p) => acc * p.prob, 1);
    return { picks, combinedOdds, combinedProb };
  }).filter(p => p.combinedProb > 0);
}

function generateParlaysWithMode(fights, probMode) {
  const combinations = [];
  const n = fights.length;
  const maxN = 5;
  if (n > maxN) throw new Error(`generateParlays: ${n} fights exceeds cap of ${maxN}.`);
  const fightProbMap = {};
  fights.forEach(f => { fightProbMap[f.id] = computeFightProbabilities(f, probMode); });
  function recurse(idx, currentParlay) {
    if (idx === n) { if (currentParlay.length>0) combinations.push(currentParlay); return; }
    const f = fights[idx];
    const [a, b] = fightProbMap[f.id];
    if (!isNaN(a.odds) && a.prob > 0) recurse(idx + 1, [...currentParlay, { fight: f.id, name: a.name, odds: a.odds, prob: a.prob, status: a.status }]);
    if (!isNaN(b.odds) && b.prob > 0) recurse(idx + 1, [...currentParlay, { fight: f.id, name: b.name, odds: b.odds, prob: b.prob, status: b.status }]);
  }
  recurse(0, []);
  return combinations.map(picks => {
    const combinedOdds = picks.reduce((acc, p) => acc * p.odds, 1);
    const combinedProb = picks.reduce((acc, p) => acc * p.prob, 1);
    return { picks, combinedOdds, combinedProb, _meta: { mode: probMode, perLegModeUsed: fights.map(f => (fightProbMap[f.id]?.[0]?.modeUsed) || probMode) } };
  }).filter(p => p.combinedProb > 0);
}

function computeKelly(parlays, bankroll) {
  const rows = parlays.map(p => {
    const f = kellyFraction(p.combinedOdds, p.combinedProb);
    const stake = f > 0 ? bankroll * f : 0;
    return { ...p, fraction: f, stake };
  });
  const sumStake = rows.reduce((s, r) => s + r.stake, 0);
  if (sumStake > bankroll && sumStake > 0) {
    const scale = bankroll / sumStake;
    rows.forEach(r => r.stake = r.stake * scale);
  }
  rows.sort((a, b) => b.stake - a.stake);
  return rows;
}
function computeEqualStake(parlays, bankroll) {
  if (parlays.length === 0) return [];
  const stakeEach = bankroll / parlays.length;
  const rows = parlays.map(p => ({ ...p, stake: stakeEach }));
  rows.sort((a, b) => b.combinedOdds - a.combinedOdds);
  return rows;
}
function computeYOLO(parlays, bankroll) {
  if (parlays.length === 0) return [];
  const best = [...parlays].sort((a, b) => b.combinedOdds - a.combinedOdds)[0];
  return [{ ...best, stake: bankroll, yolo: true }];
}
function computeSinglesRows(fights, bankroll, probMode) {
  const bets = [];
  fights.forEach((fight, i) => {
    const [a, b] = computeFightProbabilities(fight, probMode);
    const ka = kellyFraction(a.odds, a.prob);
    const kb = kellyFraction(b.odds, b.prob);
    if (ka > 0) bets.push({ fight: i + 1, name: a.name, odds: a.odds, prob: a.prob, fraction: ka, status: a.status });
    if (kb > 0) bets.push({ fight: i + 1, name: b.name, odds: b.odds, prob: b.prob, fraction: kb, status: b.status });
  });
  const rows = bets.map(b => ({
    picks: [{ fight: b.fight, name: b.name, status: b.status, odds: b.odds, prob: b.prob }],
    combinedOdds: b.odds, combinedProb: b.prob, stake: bankroll * b.fraction
  }));
  const totalStake = rows.reduce((s, r) => s + r.stake, 0);
  if (totalStake > bankroll && totalStake > 0) {
    const scale = bankroll / totalStake;
    rows.forEach(r => r.stake = r.stake * scale);
  }
  return rows;
}
function simulateStrategy(fights, rows, bankroll, trials, probMode, seed) {
  trials = trials || 1000;
  let rngSeed = (seed == null ? 42 : seed) >>> 0;
  function rng() {
    rngSeed = (rngSeed + 0x6D2B79F5) >>> 0;
    let t = rngSeed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const results = [];
  const winners = fights.map(fight => {
    const [a, b] = computeFightProbabilities(fight, probMode);
    return { a, b };
  });
  for (let i = 0; i < trials; i++) {
    const outcomes = {};
    winners.forEach((w, idx) => {
      const fightId = idx + 1;
      outcomes[fightId] = rng() < w.a.prob ? w.a.name : w.b.name;
    });
    let totalStaked = 0, totalReturn = 0;
    rows.forEach(bet => {
      totalStaked += bet.stake;
      const won = bet.picks.every(p => outcomes[p.fight] === p.name);
      if (won) totalReturn += bet.stake * bet.combinedOdds;
    });
    results.push(totalReturn - totalStaked);
  }
  results.sort((a, b) => a - b);
  function q(p) { return results[Math.floor(p * (results.length - 1))]; }
  return {
    median: q(0.5), p5: q(0.05), p95: q(0.95),
    drawdownProb: results.filter(x => x < -0.3 * bankroll).length / results.length,
    trials, resultsN: results.length
  };
}

function closedFormMetrics(rows, bankroll) {
  let ev = 0, variance = 0, totalStake = 0, lossProb = 1;
  rows.forEach(r => {
    const profit = r.stake * (r.combinedOdds - 1);
    const loseAmt = -r.stake;
    ev += r.combinedProb * profit + (1 - r.combinedProb) * loseAmt;
    const meanTrial = r.combinedProb * profit + (1 - r.combinedProb) * loseAmt;
    variance += r.combinedProb * Math.pow(profit - meanTrial, 2) + (1 - r.combinedProb) * Math.pow(loseAmt - meanTrial, 2);
    lossProb *= (1 - r.combinedProb);
    totalStake += r.stake;
  });
  const covered = totalStake <= bankroll ? 0 : totalStake - bankroll;
  return { ev, variance, sd: Math.sqrt(variance), totalStake, overcommit: covered, lossProb, bankroll };
}

function truncateParlaysByKelly(parlays, limit) {
  limit = limit || 1000;
  const withK = parlays.map(p => ({ ...p, rawKelly: kellyFraction(p.combinedOdds, p.combinedProb) }));
  withK.sort((a, b) => b.combinedProb * b.combinedOdds - a.combinedProb * a.combinedOdds);
  if (withK.length <= limit) return { rows: withK, warn: null, count: withK.length };
  return { rows: withK.slice(0, limit), warn: `Analysis truncated to top ${limit} combinations by EV.`, count: withK.length };
}

function computeAllStrategies(payload) {
  const fights = payload.fights || [];
  if (!Array.isArray(fights) || fights.length === 0) throw new Error("payload.fights must be a non-empty array.");
  if (fights.length > 5) throw new Error("fights capped at 5 (2^5=32 full parlays safe).");
  const bankroll = Number(payload.bankroll);
  if (!isFinite(bankroll) || bankroll <= 0) throw new Error("payload.bankroll must be positive number.");
  const probMode = (["user","fn","market"].indexOf(payload.probMode) >= 0) ? payload.probMode : "user";
  const mcTrials = Math.max(100, Math.min(50000, Number(payload.mcTrials) || 10000));
  const truncLimit = Math.max(10, Math.min(2000, Number(payload.truncateParlaysLimit) || 1000));
  const trunc = truncateParlaysByKelly(generateParlaysWithMode(fights, probMode), truncLimit);
  const parlays = trunc.rows;
  const kelly = computeKelly(parlays, bankroll);
  const equal = computeEqualStake(parlays, bankroll);
  const yolo = computeYOLO(parlays, bankroll);
  const singles = computeSinglesRows(fights, bankroll, probMode);
  const perStrategy = (name, rows) => ({
    name, rowsN: rows.length,
    closedForm: closedFormMetrics(rows, bankroll),
    monteCarlo: simulateStrategy(fights, rows, bankroll, mcTrials, probMode, (name.length * 9301 + probMode.length) >>> 0),
    rowsHead: rows.slice(0, 10),
  });
  const fightsAnnotated = fights.map(f => {
    const probs = computeFightProbabilities(f, probMode);
    return { id: f.id, fighters: probs };
  });
  return {
    engineMeta: { probMode, bankroll, fightsN: fights.length, parlayCombinationsTotal: trunc.count, truncatedTo: trunc.rows.length, warn: trunc.warn, mcTrials },
    fights: fightsAnnotated,
    strategies: {
      kellyParlays: perStrategy("Fractional Kelly Parlays", kelly),
      equalStake: perStrategy("Equal Stake Parlays", equal),
      yolo: perStrategy("YOLO Parlays", yolo),
      singles: perStrategy("Kelly Singles", singles),
    },
    rankingByMcMedian: ["singles","kellyParlays","equalStake","yolo"].sort((a,b) =>
      (a === "singles" ? -1 : 0) - (b === "singles" ? -1 : 0) ||
      (perStrategyDummy(b) - perStrategyDummy(a))
    ),
    _generatedAt: new Date().toISOString()
  };
  function perStrategyDummy(key) {
    return ({
      kellyParlays: kelly, equalStake: equal, yolo, singles
    })[key] && ({
      kellyParlays: simulateStrategy(fights, kelly, bankroll, mcTrials, probMode, 1),
      equalStake: simulateStrategy(fights, equal, bankroll, mcTrials, probMode, 2),
      yolo: simulateStrategy(fights, yolo, bankroll, mcTrials, probMode, 3),
      singles: simulateStrategy(fights, singles, bankroll, mcTrials, probMode, 4),
    })[key].median;
  }
}

module.exports = {
  FN,
  loadBundle, resolveFighterBio,
  computeFightMarket, computeFightnomicsProbForFight, computeFightProbabilities,
  kellyFraction, generateParlays, generateParlaysWithMode,
  computeKelly, computeEqualStake, computeYOLO, computeSinglesRows,
  simulateStrategy, closedFormMetrics, truncateParlaysByKelly,
  computeAllStrategies,
};
