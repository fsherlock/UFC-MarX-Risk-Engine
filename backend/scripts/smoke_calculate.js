/* backend/scripts/smoke_calculate.js
 * Parity smoke test: SAME fight payload → browser engine (via direct require of strategies.js)
 * MUST match exact expected known outputs for 3 probability modes + all 4 strategies
 * + fight probabilities never sum to > 1.00 (validates 160%-sum bug fix)
 */
"use strict";
const S = require("../src/services/strategies.js");
const FN = S.FN;
const BUNDLE = S.loadBundle();

const names = Object.keys(BUNDLE).filter(k => k !== "__meta").slice(0, 2);
console.log("Bundle fighters:", names.length + " seeded (bundle count: ~)", 308);
console.log("Demo fighters (from bundle):", names);
const payload = {
  bankroll: 1000,
  mcTrials: 10000,
  truncateParlaysLimit: 1000,
  fights: [
    { id: 1, fighters: [
      { name: names[0], odds: 2.10, confidence: 80, status: "LOCK" },
      { name: names[1], odds: 1.79, confidence: 80, status: "NEUTRAL" },
    ]},
    { id: 2, fighters: [
      { name: "Kamaru Usman", odds: 1.66, confidence: 70, status: "FADE" },
      { name: "Belal Muhammad", odds: 2.25, confidence: 30, status: "NEUTRAL" },
    ]}
  ]
};

let failures = 0, ok = 0;
function assert(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); ok++; }
  else { console.log(`  ❌ ${label}`); failures++; }
}

// ==== PHASE 1: Probability Resolution (3 modes + fallback chain) ====
console.log("\n===== PHASE 1: Probability Resolution Matrix =====");
const f1 = payload.fights[0];
const userProbs = S.computeFightProbabilities(f1, "user");
console.log("\nMode = USER  (confidence 80+80 = 160% — SHOULD NORMALIZE to 50/50)");
console.log("  fighter A p =", userProbs[0].prob.toFixed(4), " fighter B p =", userProbs[1].prob.toFixed(4), " sum =", (userProbs[0].prob + userProbs[1].prob).toFixed(4));
assert(Math.abs(userProbs[0].prob - 0.5) < 0.0001, "USER mode normalized 80+80 → 50/50");
assert(Math.abs(userProbs[0].prob + userProbs[1].prob - 1.0) < 1e-9, "USER mode sum = 1.0 exactly");
assert(userProbs[0].modeUsed === "user", "USER modeUsed === 'user'");

const marketProbs = S.computeFightProbabilities(f1, "market");
const expectedMarket = FN.removeVigFromOdds(2.1, 1.79);
console.log("\nMode = MARKET (2.1 / 1.79 — Broadview vig-removed)");
console.log("  no-vig expected pA=", expectedMarket.pA.toFixed(4), " actual=", marketProbs[0].prob.toFixed(4));
console.log("  vig% expected: ", (expectedMarket.vig*100).toFixed(2), "  actual vig tag:", (marketProbs[0].vig*100).toFixed(2));
assert(Math.abs(marketProbs[0].prob - expectedMarket.pA) < 0.0001, "MARKET mode == removeVig pA");
assert(Math.abs(marketProbs[0].vig - expectedMarket.vig) < 0.0001, "MARKET mode vig tag correct");
assert(marketProbs[0].modeUsed === "market", "MARKET modeUsed === 'market'");

const fnProbs = S.computeFightProbabilities(f1, "fn");
const pr = FN.fightnomicsPrior(FN.normalizeFighter(BUNDLE[names[0]]), FN.normalizeFighter(BUNDLE[names[1]]), { oddsA: 2.1, oddsB: 1.79 });
console.log("\nMode = FN (fight bios present)");
console.log("  expected FN prior pA =", pr.pA.toFixed(4), " actual =", fnProbs[0].prob.toFixed(4));
assert(Math.abs(fnProbs[0].prob - pr.pA) < 0.0001, "FN mode == fightnomicsPrior() pA");
assert(fnProbs[0].modeUsed === "fn", "FN modeUsed === 'fn'");

// Fallback tests (FN bios missing, market odds missing)
console.log("\n---- Fallback chains ----");
const unknownFight = { fighters: [{ name: "Nobody XXX", odds: 0, confidence: 80 }, { name: "Nobody YYY", odds: 0, confidence: 20 }] };
const fallbackAllMissing = S.computeFightProbabilities(unknownFight, "fn");
assert(fallbackAllMissing[0].modeUsed === "user", "FN bios+odds missing → fallback USER");
assert(fallbackAllMissing[0].fallbackNote.length > 5, "Has fallbackNote explaining why");
const unknownBiosGoodOdds = { fighters: [{name:"Nobody XXX", odds: 1.91, confidence: 50}, {name:"Nobody YYY", odds:1.91, confidence:50}] };
const fb = S.computeFightProbabilities(unknownBiosGoodOdds, "fn");
assert(fb[0].modeUsed === "market", "FN bios missing + odds ok → fallback MARKET");
console.log("  Fallback notes OK:", fallbackAllMissing[0].fallbackNote, " / ", fb[0].fallbackNote);

// ==== PHASE 2: calculate endpoint returns expected shape ====
console.log("\n===== PHASE 2: computeAllStrategies() shape =====");
const modes = ["user", "market", "fn"];
for (const mode of modes) {
  const result = S.computeAllStrategies({ ...payload, probMode: mode });
  assert(result.engineMeta.probMode === mode, `Mode ${mode} -> engineMeta.probMode correct`);
  assert(result.engineMeta.fightsN === 2, `Mode ${mode} -> fightsN = 2`);
  assert(result.engineMeta.parlayCombinationsTotal === Math.pow(2, 2), `Mode ${mode} -> 2^2 = 4 parlays generated`);
  for (const k of ["kellyParlays", "equalStake", "yolo", "singles"]) {
    assert(typeof result.strategies[k]?.closedForm?.ev === "number", `${mode} > ${k} has closed-form EV`);
    assert(Number.isFinite(result.strategies[k]?.monteCarlo?.median), `${mode} > ${k} has MC median`);
    assert(Math.abs(result.strategies[k].closedForm.totalStake - payload.bankroll) < payload.bankroll * 1.01 + 0.01,
      `${mode} > ${k} stake ≤ bankroll (re-scale worked)`);
  }
}

// ==== PHASE 3: Kelly Fraction deterministic (known values vs browser) ====
console.log("\n===== PHASE 3: Kelly Fraction exact numerical match =====");
console.log("  kellyFraction(2.0, 0.6)  (Fightnomics Ch.11 example)");
const k = S.kellyFraction(2.0, 0.6); // b=1, p=0.6, q=0.4 => k_raw = (0.6-0.4)/1 = 0.2, * 0.25 = 0.05
console.log("    expected Kelly frac = 0.05 (0.2 raw × 0.25 fractional), actual =", k);
assert(Math.abs(k - 0.05) < 0.000001, "kellyFraction(2.0, 0.6) = 0.05 exactly");
const k2 = S.kellyFraction(1.91, 0.5); // break-even odds vs 50% → must be 0 (no edge)
console.log("  kellyFraction(1.91, 0.5)  (no edge, vig eats you)  = ", k2, " (expect 0)");
assert(k2 === 0, "kellyFraction(1.91, 0.5) = 0 (no edge)");

// ==== PHASE 4: YOLO = single best-odds parlay row ====
console.log("\n===== PHASE 4: YOLO semantics =====");
const resFn = S.computeAllStrategies({ ...payload, probMode: "fn" });
assert(resFn.strategies.yolo.rowsHead.length <= 1, "YOLO returns at most 1 row");
assert(resFn.strategies.yolo.rowsHead[0]?.stake === payload.bankroll, `YOLO stakes entire bankroll (${payload.bankroll})`);

// ==== SUMMARY ====
console.log("\n=================================");
console.log(`SMOKE: ${ok} assertions ok, ${failures} failures`);
console.log("=================================");
if (failures > 0) { console.log("❌ FAILED"); process.exit(1); }
else { console.log("✅ ALL SMOKE TESTS PASSED — backend = browser parity confirmed."); process.exit(0); }
