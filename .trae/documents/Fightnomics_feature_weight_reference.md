# Fightnomics + MMA Bets Feature Weight Reference
> UFC MarX Risk Engine · static weight/coefficient table

This document lists every coefficient used by `js/fightnomics.js` when computing
`FN.fightnomicsPrior(A, B, ctx)`. Each prior-pp weight operates on a (per-fight)
feature delta Δ = feature(A) − feature(B) and contributes `weight(feat) × Δ` to
the logit-domain z-score before sigmoid. The logit baseline is 0 (50:50) when no
biases or deltas are active.

All coefficients are **read-only defaults** derived from a synthesis of:
* **Fightnomics (Kuhn & Crigger, 2013)** — conceptual magnitudes & rank order
* **MMA Bets Vol. 1 (Broadview)** — vig-removal algebra & stake-sizing filters
* **UFC Stats official FightMetric (via Kaggle UFC Fighters 2024)** — per-feature
  population μ/σ normalizers
* **namiqi (2026) UFC winner LogReg baseline (0.76 ROC-AUC)** — relative ranking
  of the 8 FightMetric coefficients

Override any coefficient at runtime via `window.WEIGHTS_OVERRIDES = { ... }`
before the page fires `buildFights()`. Example:
```js
window.WEIGHTS_OVERRIDES = { reachCm: 0.03, perf: { slpm: 0.04 } };
```

---

## 1. Fightnomics Conceptual Feature Weights (Δ-domain, logit pp per 1 unit)

| Weight key | Magnitude | Feature / Effect | Source chapter / notes |
|---|---|---|---|
| `reachCm` | **+0.022** per +1 cm reach | Reach advantage (slightly concave above +10 cm). Bonus weight for the **ape index** term below. | Fightnomics Ch.6 — "The Reach Advantage" (~+2.2 pp / 10 cm) |
| `apeIndexCm` | **+0.016** per +1 cm ape-index (reach − height) | Long-armed fighters outperform the raw-reach prediction in the 155–185 lbs corridor. | Fightnomics Ch.6 "Body Type Effects" |
| `southpawVsO` | **+0.032** (+3.2 pp) applied to the **southpaw** when matchup is **Southpaw vs Orthodox** | The 54–56 % head-to-head first-strike + damage advantage. Switch-vs-switch cancels. Orth-vs-orth cancels. | Fightnomics Ch.5 "Stance Matters" |
| `ageGapYear` | **+0.005** per +1 year of age gap (the younger fighter gains) | Fightnomics Ch.7 "Father Time" — younger fighter = ~+0.5 pp per year. Capped at a 10 year effective gap. | Fightnomics Ch.7 · Kotrba 2023 glass-jaw proxy (>33y & KO-loss rate > 30%) |
| `rust12moPlus` | **−0.028 (−2.8 pp)** on a fighter inactive ≥ 12 months | "Ring rust" layoff penalty. Scales linearly 0–18 months and caps at 18m. | Fightnomics Ch.8 "Ring Rust" · Sherdog/Tapology `last_fight` date |
| `debutJitters` | **−0.030 (−3.0 pp)** on a fighter making their **UFC debut** | "Octagon jitters" penalty. Removed after 2 Zuffa bouts. | Fightnomics Ch.10 "Octagon Experience" |
| `winStreak` | **+0.004 (+0.4 pp)** per consecutive win (momentum proxy) | Max effective streak = 7. Includes the "contender bias" over-achievers. | Fightnomics Ch.9 "Win Streaks, Rankings" |
| `weightMissKg` | **−0.008 per kg (−0.8 pp/kg)** missed on weigh-in day | Fightnomics Ch.4 — weight-miss correlates with second-half cardio collapse. Capped at −5 pp. | Fightnomics Ch.4 + Broadview anecdotal |
| `logRegBias` | **0** | Constant added to z after all deltas summed. Baseline is 0 (priors are A/B symmetric). | namiqi 2026 (bias term intentionally removed for matchup symmetry) |
| `priorMaxShift` | **0.30** | Maximum absolute z-shift before logistic sigmoid: | |
| `clampMin` / `clampMax` | **0.08 / 0.92** | Output prior is never more extreme than 92:8 — avoids degenerate Kelly sizing. | Broadview stake-sizing filter |

---

## 2. UFC Stats FightMetric Δ-weights (8 features, Kaggle-population μ/σ normalized)

Each FightMetric stat `statA, statB` is first z-normalized against the
Kaggle-UFC-4111 fighter population mean/σ before multiplying:
`z_per_stat = (statA − statB) / σ_kaggle`. The 8 z-scores are then multiplied
by their respective `weights.perf.<key>` coefficients and summed into
`_perfZ` (exposed as `prior.diagnostics._perfZ` in the return struct).

| Key | Kaggle μ | Kaggle σ | Coefficient (per +1 σ) | Source (Kaggle UFC Fighters 2024) |
|---|---|---|---|---|
| `slpm` | 2.44 | 1.99 | **+0.030 (+3 pp / +σ)** — Significant Strikes Landed / min | UFC Stats official · FightMetric · namiqi 2026 LogReg coef ≈ 0.30 (rank 4/8) |
| `stracc` | 35.5 | 20.4 | **+0.035 (+3.5 pp / +σ)** — Significant Striking Accuracy % | UFC Stats official · namiqi 2026 LogReg coef (rank 1/8) — accuracy beats volume |
| `sapm` | 3.15 | 2.85 | **−0.025 (−2.5 pp / +σ)** — Significant Strikes Absorbed / min | Negative sign: being hit more → loss. UFC Stats official. |
| `strdef` | 42.6 | 22.3 | **+0.032 (+3.2 pp / +σ)** — Significant Strike Defense % | UFC Stats official · namiqi 2026 (rank 2/8) — defense > offense |
| `td15m` | 1.25 | 1.94 | **+0.024 (+2.4 pp / +σ)** — Takedowns per 15 minutes | UFC Stats official · grappling-volume signal |
| `tdacc` | 26.3 | 28.7 | **+0.020 (+2.0 pp / +σ)** — Takedown Accuracy % | UFC Stats official · skill over-volume |
| `tddef` | 39.0 | 34.4 | **+0.028 (+2.8 pp / +σ)** — Takedown Defense % | UFC Stats official · sprawl-and-brawl durability |
| `sub15m` | 0.61 | 1.51 | **+0.022 (+2.2 pp / +σ)** — Submission Attempts per 15 min | UFC Stats official · finishing-threat signal |

**Reference equation**:
```
perf_z = Σ ( weight[stat] × ( stat[A] − stat[B] ) / sigma_pop[stat] )
       for stat in {slpm, stracc, sapm, strdef, td15m, tdacc, tddef, sub15m}
```

---

## 3. MMA Bets Vol. 1 (Broadview) — Calibration Logic

| Function | Formula / Behaviour | Purpose |
|---|---|---|
| `FN.removeVigFromOdds(decA, decB)` | `noVigA = (1/oA) / (1/oA + 1/oB)` ; `vig = 1/oA + 1/oB − 1` | Removes bookmaker overround so Fightnomics prior can be compared apples-to-apples with market "true" probability. (Used by calibration panel: Market column.) |
| `FN.edgeVsMarket(userA, marketA, agree, disagree, fnA)` | Computes a 4-tier edge class: **NOISY / WEAK / GENUINE / STRONG** based on: (a) FN-vs-market gap, (b) FN-vs-user alignment, (c) user-vs-market sign. | STRONG ⇔ FN confirms user direction vs market by ≥ 6 pp AND user isn't contrarian. **Calibration UI Tier pills.** |
| `FN.broadviewStakeWarning(rawKelly, edgePct, actualPct)` | `actual / rawKelly > 2.0` ⇒ severity=bad; `> 1.25` ⇒ caution. | Warns when user stake is YOLO-equivalent and on a ruin-path. (Wireframe hook for strategy sizing warnings — ready to consume in next phase.) |
| `FN.tapologyOddsDriftPrior(text)` | Parses Tapology-odds-drift paste format and emits ±2 % clamped logit shift. | Optional freeform input — no UI wire yet; backend only (honours no-live-scraping policy). |

---

## 4. Source Citation Map (FN._sources)

```
fightnomics → Fightnomics — Kuhn & Crigger (2013)
mmaBets    → MMA Bets Vol 1 — Broadview (odds framework)
ufcStats   → UFC Stats official / FightMetric (via Kaggle 2024 dataset)
kaggle     → Kaggle UFC Fighters Statistics 2024 / Dabbert 2021 / namiqi 2026
sherdog    → Sherdog / Tapology historical data (via Kaggle snapshots)
kotrba2023 → Kotrba 2023 — glass jaw > 33y proxy
namiqi2026 → namiqi 2026 — pre-fight UFC winner LogReg baseline (0.76 ROC-AUC)
```

Per-feature `signal.detail` strings in the prior's returned `signals[]` array
include the exact source. Hovering over a **Signal Chip** in the expanded
4-column Tale of the Tape displays the source + detail as a tooltip.
