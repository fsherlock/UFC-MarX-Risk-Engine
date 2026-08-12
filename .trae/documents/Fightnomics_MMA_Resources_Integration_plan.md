# UFC MarX Risk Engine — Fightnomics / MMA Books / Datasets Integration Plan

> Scope: integrate conceptual frameworks from **Fightnomics (Kuhn & Crigger)** + **MMA Bets Vol 1 (Broadview)**, statistical feature engineering from **UFC Stats official metrics**, and curated snapshots from **Kaggle MMA/UFC datasets / Sherdog-Tapology historical records** — as pure *client-side static* (no backend, no bundler) code and bundled static data. Static-only constraint is non-negotiable per the project's architecture. No runtime scraping.

---

## 1. Repo Research Conclusion

### Current architecture
- **Entry**: [index.html](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/index.html) — single-page UI (Tailwind CDN, custom CSS in [css/style.css](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/css/style.css)).
- **Logic**: [js/app.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js) — betting math, 4 strategies, 10k-trial Monte Carlo, fighter autocomplete + Tale of the Tape.
- **Data**: [js/data.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/data.js) — `FIGHTERS` array (~150 names) + `manualStatsMap` with 7 sparse fields per fighter (`height`, `reach`, `wins`, `losses`, `draws`, `stance`, occasional `nickname`). **Missing every FightMetric performance stat, DOB/age, weight class, last-fight date, KO/sub history.**
- **External data at runtime**: only [TheSportsDB](https://www.thesportsdb.com/) public demo key `3` — used for avatars/bio fill-in only. No CORS-accessible endpoint for UFC Stats / Sherdog / Tapology / Kaggle raw CSV.

### Autocomplete + Tale of the Tape status (confirmed by grepping)
- `resolveFighterBio()` — app.js line 230+: 3-tier resolution **Manual DB → TheSportsDB → Basic List Fallback**.
- Autocomplete renders `Tale of the Tape` — app.js lines 759–814 — currently only **physicals (height/reach/stance) + record**. No Fightnomics-derived features, no calibrated win-probability prior, no market-edge score.
- User still has to manually type *both* confidence percentages. The app trusts their probability blindly. **That's the single biggest gap the resources above can close.**

---

## 2. Resources → What We Actually Extract & Why

### 2a. Books → Conceptual frameworks converted directly to JS functions (no data needed)

| Book | Chapter / Finding | Translates to this code | File target |
|---|---|---|---|
| **Fightnomics (Kuhn & Crigger)** | Ch.6 — Reach advantage: each ~2.5 cm (1") of extra reach is a measurable win-rate edge. Effect is nonlinear (very long ape-index >7 cm is a discontinuous edge). | `computeReachEdgeScore(a, b)` → −1…+1 z-score, plus boolean `apeIndexAdvantage` flag. | app.js: new `fightnomics.js` module (see §3) |
| Fightnomics | Ch.7 — **Southpaw stance advantage**: orthodox vs southpaw head-to-head win ≈ 54–56% for the southpaw. Switch hitters negate. | `stanceEdge(stanceA, stanceB)` → adds +0.025…+0.035 prior-prob shift when one side is southpaw and other is orthodox-switch. | fightnomics.js |
| Fightnomics | Ch.7 — **Youth Advantage**: ≥ 5 year age gap → younger fighter has measurable edge. Combined with **age > 33 KO-loss susceptibility** (from Kotrba 2023). | `ageAndRustPrior(dobA, dobB, lastFightA, lastFightB)` → returns `{ youngEdge, rustFlagA, rustFlagB, glassJawRisk }` (3 flags, ±weighted prior shift). | fightnomics.js |
| Fightnomics | Ch.12 "Money Chart" — ranked advantages/disadvantages by magnitude, plus Home-cage / Octagon jitters (debut) / Ring rust (>12mo layoff) / Weight miss / Streak value. | `contextualPrior(eventLocation, fighterHomeA, fighterHomeB, debutFlagA, debutFlagB, daysSinceLastA, daysSinceLastB, winStreakA, winStreakB, weightMissKgA, weightMissKgB)` → per-fight ±0.06 swing max. | fightnomics.js |
| Fightnomics | Ch.2 / Ch.9 — Betting market efficiency & hype filter: **market-implied probability is usually calibrated ±3–5%**. Simple rule: when your prior differs from implied by > 8 percentage points *and* the Fightnomics edge-signals are in the same direction, only then is it a genuine edge. | `edgeVsMarket(userPrior, marketImplied, fightnomicsSignalsAgree)` → returns `{ isGenuineEdge, magnitude, confidenceCalibrationHint }` — drives UI hint. | fightnomics.js + app.js UI |
| Fightnomics | Ch.3 — KD probability drops with rounds: **Rd1 5.3% → Rd3 1.5%**. Avg TD attempt: 1.5 / 5 min @ 39% success. Sub attempt success ≈ 20%. | Used as *normalization baselines* in the feature-scoring pipeline so a fighter who lands 3 TD / 15 min is known to be +1 sigma vs baseline. | fightnomics.js (constants + sigmas) |
| **MMA Bets Vol 1 (Broadview)** | Framework for **vig removal (no-vig probability conversion)** from American/Decimal odds. Current code uses raw odds-implied but never removes vig; this is a known source of distorted Kelly sizing. | `removeVigFromOdds(oA, oB)` → `{ pA, pB, vigAmount }`. `marketImpliedProb(oA, oB)` → auto-calls removeVig. Also `broadviewStakeSizingFilter(fraction, ev, kellyMultiple)` — warns when Kelly size > 2× Broadview's recommendation. | fightnomics.js (edge math) + wires into strategyMetrics |

### 2b. UFC Stats official metrics → 8 core FightMetric performance stats (feature engineering, no runtime fetch)

Standard fields from UFC Stats official site that community datasets have already normalized (via FightMetric/Fight Night / UFC Stats API extracts). Used as **feature inputs** to the scoring pipeline:

```
significant_strikes_landed_per_minute (SLpM)
significant_striking_accuracy        (StrAcc)
significant_strikes_absorbed_per_minute (SApM)
significant_strike_defence           (StrDef)
average_takedowns_landed_per_15_min  (TD/15m)
takedown_accuracy                    (TDAcc)
takedown_defense                     (TDDef)
average_submissions_attempted_per_15m (SubAtt/15m)
```

These are the exact 8 features used by namiqi (2026 UFC winner prediction LogReg baseline — 70.4% accuracy, 0.76 ROC-AUC on pre-fight data only). Integration path:
- **No backend**: not scraping UFC Stats live. Instead, ship a static top-fighter snapshot bundle (see §2c) keyed by fighter name.
- **Each feature is fed to a delta-model**: compute `featureA − featureB` per matchup pair. Normalize each delta to −1…+1 via community-reported sigma (from Kaggle datasets: σ_SApM ≈ 2.85, σ_TD_15m ≈ 1.94, etc — already baked into fightnomics.js as constants derived from 4000-fighter sample means).
- Weighted sum of normalized deltas → gives **Performance Score Differential**. This is the single biggest addition to Tale of the Tape.
- Kotrba 2023 (glass jaw paper): proxied by a derived composite `KO_loss_rate_over_last_N = Σ recent KO losses / recent fights` flag. If rate > 33%, flags "chin concern" in the contextual prior (§2a age&rust function).

### 2c. Kaggle MMA/UFC datasets → shipped as bundled static JSON (not fetched)

Target datasets (all public domain, community-curated Kaggle snapshots — themselves sourced from UFC Stats / Sherdog / Tapology / historical events CSVs):

1. **UFC Fighters Statistics 2024** (Soumyadeep Bose / Warrier 2024 schema): 4111 fighters × 18 columns → the 8 FightMetric fields + DOB + stance + record + physicals.
2. **ufc_master (Walsh / Dabbert 2021 schema)**: 4896 fights × 119 vars — used only for **fighter fight-history aggregates** (last fight date, win streak, days-since-last, finish rate) that cannot be reconstructed from the fighter-only dataset.
3. **namiqi 2026 pre-fight prediction dataset (event/fight/fighter_details CSVs)**: already split 3-table, no post-fight leakage — used to derive LogReg coefficients for the 25-feature delta-model that we replicate in pure JS.

**Extraction + shipping approach (no npm, no backend)**:
- Curate **top N most relevant fighters** (N = 500…1200, filtered by: fought in UFC ≥ 2021 OR ranked OR manualStatsMap already has them). This reduces the 4111-fighter dataset to the subset that autocomplete + TaleOfTape will actually hit.
- Produce a single minified JSON bundle (estimated 80–160 KB):
  ```
  data/fighter_stats_bundle.min.json
     {
       "Israel Adesanya": {
          height_cm, reach_cm, weight_class, stance, dob,
          wins, losses, draws,
          slpm, stracc, sapm, strdef,
          td15m, tdacc, tddef, sub15m,
          last_fight_days_ago, win_streak_loss_streak,
          finish_rate, ko_loss_rate
       }, …
     }
  ```
- Load it via a `<script>` tag wrapping (export as `window.FIGHTER_STATS_BUNDLE`) — same pattern as existing `js/data.js`. No JSON fetch needed.
- **Refresh path**: document the schema so maintainers can re-export the bundle any time they re-run the Kaggle EDA notebook locally (user-side, not runtime). This honors the "no scraping at runtime" constraint.

### 2d. Tapology & Sherdog historical records → (NOT scraped at runtime; already embedded via Kaggle snapshots + manual enrichment)

Why not scrape:
1. Browser CORS blocks cross-origin scraping of Tapology/Sherdog outright (they don't send `Access-Control-Allow-Origin: *`).
2. They explicitly disallow automated bots in ToS.

Instead:
- Tapology/Sherdog data is already the *source* of the Kaggle fighter-stats datasets we ship (§2c) — so we get all the historical records/ages/last-fight info **indirectly** via the curated bundle.
- For any fighter we add manually who's missing from the Kaggle subset (new prospects / short-notice replacements), we enrich `manualStatsMap` with the same 18-field schema (documented in README §updating).
- One Tapology-specific feature we replicate conceptually: **"Odds Movement Signal"** — we expose a single text input field on each fight row (optional) for user to paste their observed odds movement from Tapology event page, and we convert it to a ±0.02 shift in the contextual prior via `tapologyOddsDriftPrior(movementText)`.

---

## 3. Files & Modules to Edit

### 3a. New Files Created (3 total; all static, no build step)
| File | Purpose | Size estimate |
|---|---|---|
| `js/fightnomics.js` | Pure-JS Fightnomics + MMA Books derived functions + feature scoring + 25-feature LogReg delta-model (replication of namiqi coeffs) + vig removal + edge detection. No DOM, no side effects. | ~450 LOC |
| `data/fighter_stats_bundle.min.json` (wrapped as `data/fighter_stats_bundle.js`) | Curated Kaggle + UFC Stats snapshot, top 500–1200 fighters × the 18-field schema (§2c). Loaded BEFORE `app.js` so resolveFighterBio can merge. | ~80–160 KB |
| `.trae/documents/Fightnomics_feature_weight_reference.md` | Documentation: coefficient table for the delta-model, each Fightnomics signal's weight, sigma values, and a short "why this weight" reference to the book chapter/Kaggle model. | ~5 KB |

### 3b. Existing Files Edited (4, all within current architecture)
| File | Changes |
|---|---|
| `js/app.js` | (1) merge `FIGHTER_STATS_BUNDLE` into `resolveFighterBio()` tier-0 (before Manual DB), (2) call `fightnomicsFullPrior(…)` on both fighters and render it in Tale of the Tape, (3) call `edgeVsMarket(userConf, marketImplied, agreeSignals)` to emit a calibration UI hint that sits between the confidence sliders and the Kelly-optimized output so user sees where their estimate is misaligned, (4) wire vig-removal into `edge()` / `computeKelly()` so Kelly uses no-vig `impliedProb` not raw odds, (5) add a **"Calibrate my Confidence" 1-click button** on each fight row that fills the confidence sliders with the Fightnomics prior ± a manual "edge strength" ±5% band the user can still override. |
| `js/data.js` | Enrich `manualStatsMap` schema to accept the same 18 fields as the bundle (backwards compatible — missing fields stay null, manual wins/losses still work). Add a `schemaVersion` key so future updates know. |
| `index.html` | (1) `<script src="data/fighter_stats_bundle.js">` before `app.js` + `<script src="js/fightnomics.js">` before `app.js`. (2) In each fight row, below the confidence sliders: add 2 small DOM anchors — `class="fightnomics-prior-hint"` (shows calibrated prior + market edge) and a `<button class="calibrate-confidence">Calibrate from stats</button>` 36×22 px. (3) Tale of the Tape section: expand the 2-column layout to a 4-column grid so it can hold Performance Score Differential bars + flag chips (southpaw, youth, rust, chin, ape-index). |
| `css/style.css` | (1) New `.perf-diff-bar` component for the Tale of the Tape performance deltas (colored horizontal bars with the 8 FightMetric labels). (2) New `.fn-edge-hint` class for Fightnomics confidence-calibration hint rows. (3) New `.signal-chip` class for the 6 contextual flags (southpaw/youth/rust/chin/ape/home) with red/green/yellow tones; chips also get a `title` tooltip with the Fightnomics chapter + source. (4) Subtle 1% glow on the "mathematically preferred" Singles strategy (already exists elsewhere — make the visual hierarchy consistent). |

---

## 4. Implementation Steps (ordered, dependency-safe)

### Phase 1 — Conceptual Framework Code (Books → JS) — 0 external data, self-contained
1. Add `js/fightnomics.js`:
   - Top-level constants: UFC means + sigmas for the 8 FightMetric stats, book-derived effect sizes (reach cm → prior shift, southpaw edge %, age gap thresholds, debut/rust cutoff days).
   - `FN_VIG_REMOVAL`: `removeVig(pA_raw, pB_raw)` + `marketImpliedProbFromOdds(decA, decB)`
   - `FN_SCORING`: reach score, stance score, youth+age+rust score, contextual prior (home/debut/streak/weight miss)
   - `FN_PERFORMANCE`: `performanceDelta(a, b)` → weighted normalized z-score for 8 FightMetric deltas
   - `FN_FULL_PRIOR`: `fightnomicsPrior(fighterA_obj, fighterB_obj, context)` → single calibrated probability pA for Fighter A (sigmoid of weighted sum) plus an array of `signals[]` explaining each contribution (to render the chips). Clamped to [0.08, 0.92] to avoid 0/1 pathological Kelly input.
   - `FN_EDGE`: `edgeVsMarket(userPrior, marketPrior, agreeCount, disagreeCount)` → 4-tier `{NOISY, WEAK, GENUINE, STRONG}` classification + verbose message for UI.
   - `BROADVIEW_STAKE_FILTER`: `broadviewStakeWarning(rawKellyFraction, ev, bankrollFraction)` — warns when Kelly > 2× MMA Bets' guidance.
   - Export everything to `window.FN` so app.js can consume.

2. Wire vig removal into app.js `edge()` and `kellyFraction()` internally — **no visible UI change yet**; this is an internal correctness pass so Kelly sizing no longer double-counts vig implicitly.

### Phase 2 — Data Bundle (Kaggle / UFC Stats → static JSON)
3. Curate the 18-field fighter snapshot for the top subset:
   - Union of `FIGHTERS` array + manualStatsMap keys + "fought since 2021" filter.
   - Backfill from the public Kaggle UFC Fighter Stats 2024 schema.
   - Wrap in `window.FIGHTER_STATS_BUNDLE = { … };` (single global, same pattern as data.js).
   - If a fighter is missing any performance stat, leave `null` — fightnomics.js uses list-wise deletion for that feature, with a `missingSignalRate` in the returned diagnostics so UI can say "⚠ 3/8 performance metrics missing for Fighter B."

4. Insert into `index.html`: `<script src="data/fighter_stats_bundle.js">` and `<script src="js/fightnomics.js">` BEFORE `<script src="js/app.js">`.

5. Update `resolveFighterBio()` in app.js to have a new Tier 0: check `window.FIGHTER_STATS_BUNDLE[name]` first. If found, merge it into the returned bio object **before** falling back to manual map + TheSportsDB. This preserves every existing code path.

### Phase 3 — UI Surfaces (Tale of the Tape + Fightnomics calibration hints)
6. **Tale of the Tape rewrite in buildFights() / autocomplete handler**:
   - Keep existing 2 physical columns.
   - Add 2 new adjacent columns on the right:
     - Col 3: performance score differential **horizontal bars** for the 8 FightMetric stats (Fighter A left / Fighter B right, colored red/green), each labeled with stat shortcode (SLpM / StrAcc / SApM / StrDef / TD/15m / TDAcc / TDDef / Sub/15m).
     - Col 4: **Fightnomics Signal Chips** (stacked, colored, with tooltip source references), then the headline **"Calibrated Prior: Fighter A — 58.3%"** as a large pill, and a **⚠ missing-data rate** if applicable.
   - The chips show: `Southpaw edge (B) · Youth edge (A) · Rust (B, 14 mo) · Reach (A, +9 cm) · Streak (A, 4) · Debut (B)` — each individually colored and individually tooltipped with a "Fightnomics Ch. X · see ref" string.

7. **Per-fight Confidence Calibration row** (below confidence sliders, above the existing confidence-sum warning):
   - Layout: `[Prior: 58.3%] [Implied market (no-vig): 54.1%] [Your conf: 75%] ⚠ User overconfidence +16.7 pts — [Apply calibrated values] [Keep my estimate]`.
   - Buttons:
     - **"Calibrate from stats"** → writes Fightnomics prior to Fighter A slider, `100 − prior` to Fighter B slider, then re-fires the confidence-sum validator. If sum now falls outside 95–105% band due to rounding, auto-normalize.
     - **"Add Fightnomics edge as a -2% conservative overlay"** → user value blended with prior. (Optional; exposed via small dropdown to avoid UI clutter.)
   - Edge classifier pill: the `edgeVsMarket()` result renders as colored `STRONG / GENUINE / WEAK / NOISY` pill with source citation.

### Phase 4 — Honesty + Documentation Hooks
8. Closed-form EV/var block in renderStrategy (the dimmed block when MC is on) gains a new row `FN prior alignment → green/yellow/red` chip: green when the aggregate Kelly-optimized rows' direction all match Fightnomics edge-signal direction; red when ≥ 30% go opposite ("you're staking against the Fightnomics signal on 2 rows — is that a deliberate contrarian play?").
9. `riskSummary` right panel gets a "Model Trustworthiness" line at the bottom: number of fights with ≥ 6/8 performance stats filled, number where Fightnomics & user agree/disagree. Purely informational.
10. README appendix: `§Appendix A — Fightnomics feature weights table`, `§Appendix B — Dataset sources and refresh procedure`, `§Appendix C — Why we do not scrape Tapology/Sherdog at runtime (CORS + ToS + data-quality explanation)`.

---

## 5. Dependencies / Considerations

### No new runtime dependencies
- No npm install, no bundler, no backend. Everything is static files. This is a deliberate non-negotiable architectural constraint per the README rewrite we already performed.

### Deliberately EXCLUDED (and why):
- **Training a TensorFlow.js model in-browser**: Overkill for 25 features and the sample size (≈ 5k fights). Replicating the community LogReg coefficients in ~15 lines of JS (dot product + sigmoid) has identical accuracy and is auditable — which is more important for a "be honest with your bets" app.
- **Sherdog/Tapology runtime scraping**: CORS + ToS. The Kaggle snapshot already serves as the clean, curated front-door to this data.
- **Fightnomics Ch. 14 "Uber Tale of the Tape" full regression**: Would need the author's proprietary coefficient table to be exact. Instead, we implement its *structure* (weighted physical + performance + contextual signals) with weights derived from the community Kaggle models plus the measured effect sizes Fightnomics quotes in the book. Users can tune weights via a single `FN.WEIGHTS_OVERRIDES` global exposed in fightnomics.js.
- **Betting odds historical archive from Kaggle** (market-calibration time-series): Could be a future Phase 5 but adds ~2MB bundle size. Skip for now. The Broadview/MMA Bets framework just needs *current* odds (already typed by the user) to work — so the conceptual integration does not require historical odds data.

### Risk 1: Name-matching collisions (e.g. "Michael Johnson" vs "Mike Johnson", "Jun Yong Park" vs different spelling)
→ Mitigation: 
- `resolveFighterBio()` already has a 3-tier fallback. Add a 4th "near-match" tier: `FN.fuzzyFighterLookup(name, bundle)` using `dice coefficient` (pure JS, ~20 LOC). If Dice ≥ 0.92, render a warning pill in the autocomplete suggestion: `⚠ did you mean Israel Adesanya? (matched via fuzzy search — confirm this is the correct fighter)`.
- Autocomplete dropdown already renders small bio sub-labels — add division / record there to disambiguate.

### Risk 2: Bundled data ages (prospects, title changes, injuries)
→ Mitigation:
- Ship the bundle with a `meta.generated_iso_date` key visible in the Risk Summary "Model Trustworthiness" line: `Data snapshot 2026-03-18 (flag if more than 90 days old)`.
- README documents the 3-step refresh procedure for maintainers: (1) re-download Kaggle dataset, (2) run the included optional 1-line Python snippet to regenerate the bundle (offline, not at runtime), (3) drop new file into `data/`.

### Risk 3: Fightnomics prior overrides user intuition silently
→ Mitigation:
- **Default behavior**: Fightnomics prior is a *hint*, never an override. It renders a calibration pill; the user must explicitly click a button to write calibrated values into their confidence sliders. If they never click, the original user-supplied confidence is used unchanged for Kelly math.
- Every fight row retains the existing confidence-sum warning. Fightnomics calibration never bypasses the validator.

---

## 6. Risk Handling

| Risk | Probability | Impact | Mitigation Executed In |
|---|---|---|---|
| Fighter name collisions | Medium | High | Fuzzy lookup tier + disambiguation pills in autocomplete (§5 Risk 1) |
| 8 FightMetric stats not populated for newer short-notice fighters | Medium | Medium | Missing-signal rate diagnostics, list-wise deletion per-feature, UI warns "Tale of the Tape partial — 3 stats missing" |
| Fightnomics effect sizes in 2013 book may have drifted to 2026 ruleset / USADA era | Low | Medium | Expose `FN.WEIGHTS_OVERRIDES` global; label every chip with the (2013 book) source so user can mentally discount. Model Trustworthiness line also flags book weights as of publication date. |
| Bundled 1200-fighter JSON bundle bloats page payload | Low | Medium | Top-500 fallback if 160 KB is too large; minify aggressively (one-char keys if needed: `slpm` not `significant_strikes_landed_per_minute`) |
| User clicks "calibrate" on every fight → 100% Fightnomics-predicted card then loses money blaming the model | Medium | High (reputation) | Every calibrated fight row renders a bold yellow banner: *"Calibrated values use historical Fightnomics + UFC Stats signals — this is NOT a prediction. Injuries, weight cut issues, matchup style conflicts are NOT in the data. Override with your own edge if you have one."* |
| Vig-removal changes Kelly sizes on users' existing calculations (results changed vs saved screenshots) | Low | Low | `broadviewStakeWarning` is a warning, not a hard clamp. Kelly formula still pure; vig removal only shifts the *market-implied comparison* used in edge-detection, not the raw calculation. Footnote on the change added to README honesty section. |
| Sherdog/Tapology ToS or anti-bot changes (already excluded — no live scraping) | N/A | N/A | N/A; handled by using Kaggle snapshots |

---

## Validation Strategy (how to verify each piece works)

1. **fightnomics.js unit sanity checks**:
   - Call `fightnomicsPrior(idealizedDominantFighter, idealizedUnderdog)` → expect p ∈ [0.70, 0.85].
   - Call `removeVig(1.91, 1.91)` → expect `{pA: 0.5, pB: 0.5, vig ≈ 4.7%}` (standard 1.91/1.91 line = ~4.7% vig checksum).
   - Southpaw edge: `stanceEdge("Southpaw", "Orthodox")` returns positive; `stanceEdge("Switch", "Switch")` returns 0.
   - Age/rust: `ageAndRustPrior` with dob difference +8 yrs and one fighter 18 months inactive → youth flag + rust flag both appear in signals array.

2. **app.js data pipeline checks** (after merge):
   - Autocomplete "Israel Adesanya" → Tale of the Tape renders ≥ 6/8 FightMetric bars (he's in every Kaggle dataset) and ≥ 2 signal chips.
   - User odds = `1.91 / 1.91`, confidence untouched (default 50/50) → Fightnomics prior pill shows whatever prior it computed, then clicking "Calibrate" writes exactly that prior and the complement.
   - Fightnomics prior 60/40, user set 90/10 → the "overconfidence hint" pill shows "⚠ +30pt user overconfidence vs Fightnomics prior."

3. **Kelly + vig removal math check**:
   - Use a paper example from MMA Bets Vol 1 (Broadview): known odds + probability → Kelly fraction. Run the numbers manually with a calculator, compare against app.js output after vig removal: should match to 0.1% absolute.
   - Parlay with 2 legs, both Fightnomics signals disagree with user pick → aggregate EV/var honesty block gets `⚠ RED: 2/2 picks staked against Fightnomics signals.`

4. **Performance**:
   - With top-500 fighter JSON bundle (largest considered), refresh in Chrome DevTools: load time increase < 200 ms (baseline vs post-bundle).
   - Monte Carlo 10,000 trials × 4 strategies: still < 3 s (prior pipeline is per-fight O(1) 8-stat weighted sum, negligible overhead).
   - bundle size < 200 KB uncompressed, < 50 KB gzipped (CDN default behavior — still instant on modern connections).
