/* ============================================================
 * fightnomics.js — Fightnomics (Kuhn & Crigger) + MMA Bets Vol 1 (Broadview)
 * pure-JS betting-theory + MMA feature-scoring module.
 *
 * No DOM, no side-effects, no network. Exports everything on window.FN.
 * ============================================================ */
(function (global) {
  "use strict";

  /* ---------- Population constants (from Kaggle 4000-fighter sample + Fightnomics 2013 book) ---------- */
  const UFC = {
    // 8 FightMetric stat means and standard deviations (Kaggle 2024 UFC fighter stats, N~4111)
    stats: {
      slpm:   { mu: 2.44,  sigma: 1.99, label: "SLpM",   source: "Kaggle UFC Fighters 2024", desc: "Significant strikes landed / min" },
      stracc: { mu: 35.5,  sigma: 20.4, label: "StrAcc", source: "Kaggle UFC Fighters 2024", desc: "Significant striking accuracy %" },
      sapm:   { mu: 3.15,  sigma: 2.85, label: "SApM",   source: "Kaggle UFC Fighters 2024", desc: "Significant strikes absorbed / min" },
      strdef: { mu: 42.6,  sigma: 22.3, label: "StrDef", source: "Kaggle UFC Fighters 2024", desc: "Significant strike defense %" },
      td15m:  { mu: 1.25,  sigma: 1.94, label: "TD/15m", source: "Kaggle UFC Fighters 2024", desc: "Avg takedowns landed / 15 minutes" },
      tdacc:  { mu: 26.3,  sigma: 28.7, label: "TDAcc",  source: "Kaggle UFC Fighters 2024", desc: "Takedown accuracy %" },
      tddef:  { mu: 39.0,  sigma: 34.4, label: "TDDef",  source: "Kaggle UFC Fighters 2024", desc: "Takedown defense %" },
      sub15m: { mu: 0.61,  sigma: 1.51, label: "Sub/15m", source: "Kaggle UFC Fighters 2024", desc: "Avg submission attempts / 15 minutes" },
    },
    // Fightnomics Ch.3 — baseline fight event rates (used for "sigma vs baseline" comparisons)
    baselines: {
      tdAttemptsPer5min: 1.5,
      tdSuccessRate: 0.39,
      subAttemptSuccess: 0.20,
      kdRd1: 0.053,
      kdRd3: 0.015,
    },
    // Fightnomics Ch.6/7/12 + namiqi(2026) LogReg delta-model implied weights (per 1 unit of normalized z)
    weights: {
      // Physical / matchup signals (Fightnomics book-measured)
      reachCm:      0.022,  // per cm of reach difference (Ch.6)
      southpawVsO:  0.032,  // constant shift when southpaw vs orthodox (Ch.7)
      ageGapYear:   0.005,  // per year of youth advantage, floored at 5y gap (Ch.7)
      debutJitters: 0.030,  // when opponent is on UFC debut (Ch.12)
      rust12moPlus: 0.028,  // opponent >12 months inactive (Ch.12)
      winStreak:    0.004,  // per fight streak (modest — Fightnomics Ch.12 shows streak weak signal)
      weightMissKg: 0.008,  // per kg missed weight (Ch.12)
      apeIndexCm:   0.016,  // per cm of reach > height (ape-index bonus — Ch.6 combined)
      // FightMetric performance deltas (weighted by namiqi 2026 LogReg coefficient magnitudes, normalized)
      perf: {
        slpm:   0.030,
        stracc: 0.035,
        sapm:  -0.025,   // negative because MORE absorbed = WORSE
        strdef: 0.032,
        td15m:  0.024,
        tdacc: 0.020,
        tddef: 0.028,
        sub15m:0.022,
      },
      // Prior tempering
      logRegBias:  0.00,   // baseline logit intercept (0 → 50% prior when no signals)
      priorMaxShift: 0.30, // clamp total shifted logit equivalent so prior stays sane
      clampMin: 0.08,
      clampMax: 0.92,
    },
  };

  /* ---------- Fuzzy fighter-name lookup (Dice coefficient) ---------- */
  function bigrams(s) {
    const n = s.length;
    if (n < 2) return new Set(s ? [s] : []);
    const out = new Set();
    for (let i = 0; i < n - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  function dice(a, b) {
    if (!a || !b) return 0;
    const A = bigrams(a.toLowerCase().replace(/\s+/g, ""));
    const B = bigrams(b.toLowerCase().replace(/\s+/g, ""));
    if (A.size + B.size === 0) return 0;
    let inter = 0;
    A.forEach((g) => { if (B.has(g)) inter++; });
    return (2 * inter) / (A.size + B.size);
  }
  function fuzzyFighterLookup(name, bundle, threshold) {
    threshold = threshold == null ? 0.90 : threshold;
    if (!bundle) return null;
    if (bundle[name]) return { name, exact: true, dice: 1.0 };
    let best = null; let bestD = 0;
    for (const k of Object.keys(bundle)) {
      const d = dice(k, name);
      if (d > bestD && d >= threshold) { bestD = d; best = k; }
    }
    if (!best) return null;
    return { name: best, exact: false, dice: bestD };
  }

  /* ---------- Utility math ---------- */
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const zOf = (val, mu, sigma) => (val == null || !Number.isFinite(val) || sigma <= 0) ? 0 : (val - mu) / sigma;

  /* =====================================================
   * SECTION: VIG REMOVAL — MMA Bets Vol 1 (Broadview framework)
   * ===================================================== */
  function oddsToRawImplied(decimalOdds) {
    return decimalOdds && decimalOdds > 1 ? 1 / decimalOdds : 0;
  }
  function removeVigFromOdds(decA, decB) {
    const pA_raw = oddsToRawImplied(decA);
    const pB_raw = oddsToRawImplied(decB);
    const sumRaw = pA_raw + pB_raw;
    if (!sumRaw || !Number.isFinite(sumRaw)) {
      return { pA: 0.5, pB: 0.5, vig: 0, overround: 1.0, note: "invalid odds — fell back to 50/50" };
    }
    const vig = sumRaw > 1 ? sumRaw - 1 : 0;
    return {
      pA: pA_raw / sumRaw,
      pB: pB_raw / sumRaw,
      vig: vig,
      overround: sumRaw,
      note: "no-vig probabilities via proportional renormalisation (Broadview)",
    };
  }
  function marketImpliedFromOdds(decA, decB) {
    return removeVigFromOdds(decA, decB);
  }

  /* =====================================================
   * SECTION: INDIVIDUAL SIGNAL SCORERS — all return a logit shift
   * ===================================================== */
  function _cm(v) {
    if (v == null) return null;
    if (typeof v === "number") return v;
    // accept strings like "193cm", "193 cm", "76in", "6'4\""
    if (typeof v === "string") {
      const s = v.trim().toLowerCase();
      const n = parseFloat(s);
      if (!Number.isFinite(n)) return null;
      if (s.includes("in") || s.includes('"')) return n * 2.54;
      if (s.includes("'") && s.includes('"')) {
        // ignore compound; we already only parsed first number, safer to fail
        return null;
      }
      return n; // assume cm if not explicitly in/ft
    }
    return null;
  }
  function _intOrNull(v) {
    if (v == null || v === "") return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }
  function _numOrNull(v) {
    if (v == null || v === "") return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  /* Normalize a fighter record object so all subsequent functions can rely on consistent schema.
   * Accepts: manualStatsMap schema OR bundle schema OR TheSportsDB schema. */
  function normalizeFighter(raw) {
    if (!raw) raw = {};
    const height_cm = _cm(raw.height_cm != null ? raw.height_cm : raw.height);
    const reach_cm  = _cm(raw.reach_cm  != null ? raw.reach_cm  : raw.reach);
    const wins   = _intOrNull(raw.wins);
    const losses = _intOrNull(raw.losses);
    const draws  = _intOrNull(raw.draws) || 0;
    const dob = raw.dob || raw.date_of_birth || raw.birthday || null;
    const last_fight_days_ago = _intOrNull(raw.last_fight_days_ago != null ? raw.last_fight_days_ago : raw.daysSinceLast);
    const win_streak  = _intOrNull(raw.win_streak  != null ? raw.win_streak  : raw.currentWinStreak);
    const loss_streak = _intOrNull(raw.loss_streak != null ? raw.loss_streak : raw.currentLossStreak);
    const ko_loss_rate = _numOrNull(raw.ko_loss_rate);   // 0..1
    const finish_rate  = _numOrNull(raw.finish_rate);    // 0..1
    const debut = !!raw.debut || !!raw.isUfcDebut;
    const stance = (raw.stance || "").trim() || null;
    const weight_class = (raw.weight_class || raw.division || "").trim() || null;
    const out = {
      height_cm, reach_cm, wins, losses, draws,
      dob, last_fight_days_ago,
      win_streak, loss_streak, ko_loss_rate, finish_rate,
      debut, stance, weight_class,
      nickname: raw.nickname || null,
      slpm:   _numOrNull(raw.slpm),
      stracc: _numOrNull(raw.stracc),
      sapm:   _numOrNull(raw.sapm),
      strdef: _numOrNull(raw.strdef),
      td15m:  _numOrNull(raw.td15m),
      tdacc:  _numOrNull(raw.tdacc),
      tddef:  _numOrNull(raw.tddef),
      sub15m: _numOrNull(raw.sub15m),
    };
    out._raw = raw;
    // Derived age from dob (if possible)
    out.age = dob ? _ageFromDob(dob) : null;
    out.apeIndexCm = (reach_cm != null && height_cm != null) ? (reach_cm - height_cm) : null;
    out._statsMissing = 0;
    out._statsTotal = 8;
    for (const k of ["slpm","stracc","sapm","strdef","td15m","tdacc","tddef","sub15m"]) {
      if (out[k] == null || !Number.isFinite(out[k])) out._statsMissing++;
    }
    return out;
  }
  function _ageFromDob(dob) {
    try {
      if (!dob) return null;
      let d;
      if (dob instanceof Date) d = dob;
      else if (typeof dob === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dob)) d = new Date(dob + "T00:00:00Z");
      else d = new Date(dob);
      if (isNaN(d.getTime())) return null;
      const today = new Date();
      let age = today.getFullYear() - d.getUTCFullYear();
      const m = today.getMonth() - d.getUTCMonth();
      if (m < 0 || (m === 0 && today.getDate() < d.getUTCDate())) age--;
      return age;
    } catch (_) { return null; }
  }

  /* ---- Individual sub-signals: each returns { shift, signals: [] } ---- */

  function computeReachEdge(a, b) {
    const out = { shift: 0.0, signals: [] };
    if (a.reach_cm == null || b.reach_cm == null) return out;
    const d = a.reach_cm - b.reach_cm;
    if (Math.abs(d) < 1.0) return out;
    const w = UFC.weights.reachCm;
    // slightly concave — 15cm edge is NOT 3× the shift of 5cm (Fightnomics Ch.6)
    const concavity = 1 / 1.35;
    const sign = d >= 0 ? 1 : -1;
    const s = sign * w * Math.pow(Math.abs(d), concavity);
    out.shift = s;
    out.signals.push({
      id: "reach", owner: d >= 0 ? "A" : "B",
      label: `Reach ${Math.abs(d).toFixed(0)} cm`,
      shift: s,
      source: "Fightnomics Ch.6 (range advantage)",
      tone: Math.abs(d) >= 7 ? "good" : "mild",
    });
    if (a.apeIndexCm != null && Math.abs(a.apeIndexCm) >= 4 && b.apeIndexCm != null) {
      const dApe = a.apeIndexCm - b.apeIndexCm;
      if (Math.abs(dApe) >= 3) {
        const sa = Math.sign(dApe) * UFC.weights.apeIndexCm * Math.min(5, Math.abs(dApe) / 2);
        out.shift += sa;
        out.signals.push({
          id: "ape", owner: dApe >= 0 ? "A" : "B",
          label: `Ape-index ${dApe >= 0 ? "+" : ""}${dApe.toFixed(0)} cm`,
          shift: sa,
          source: "Fightnomics Ch.6 (reach > height bonus)",
          tone: "mild",
        });
      }
    }
    return out;
  }

  function computeStanceEdge(a, b) {
    const out = { shift: 0.0, signals: [] };
    const as = (a.stance || "").toLowerCase();
    const bs = (b.stance || "").toLowerCase();
    if (!as || !bs) return out;
    let owner = null;
    if (as.startsWith("south") && !bs.startsWith("south") && !bs.startsWith("swit")) owner = "A";
    if (bs.startsWith("south") && !as.startsWith("south") && !as.startsWith("swit")) owner = "B";
    if (owner) {
      const s = (owner === "A" ? 1 : -1) * UFC.weights.southpawVsO;
      out.shift = s;
      out.signals.push({
        id: "stance", owner,
        label: "Southpaw vs Orthodox",
        shift: s,
        source: "Fightnomics Ch.7 (southpaw 54-56% H2H)",
        tone: "mild",
      });
    }
    return out;
  }

  function computeAgeAndRust(a, b) {
    const out = { shift: 0.0, signals: [] };
    // 1) Youth edge (Fightnomics Ch.7): only kicks in if gap >= 5 years
    if (a.age != null && b.age != null) {
      const gap = b.age - a.age;   // positive = A younger
      if (Math.abs(gap) >= 5) {
        const owner = gap >= 0 ? "A" : "B";
        const useGap = Math.min(15, Math.abs(gap) - 5);
        const s = (owner === "A" ? 1 : -1) * UFC.weights.ageGapYear * useGap;
        out.shift += s;
        out.signals.push({
          id: "youth", owner,
          label: `Youth edge (${Math.abs(gap)}y gap)`,
          shift: s,
          source: "Fightnomics Ch.7 (5y+ gap → measurable)",
          tone: "mild",
        });
      }
      // 2) Glass-jaw concern (Kotrba 2023): age > 33 AND ko_loss_rate elevated
      const _flagA = a.age > 33 && (a.ko_loss_rate == null ? (a.age > 36 ? 0.3 : 0) : a.ko_loss_rate) > 0.30;
      const _flagB = b.age > 33 && (b.ko_loss_rate == null ? (b.age > 36 ? 0.3 : 0) : b.ko_loss_rate) > 0.30;
      if (_flagA !== _flagB) {
        const flagOwner = _flagA ? "B" : "A";   // if A has the flag, B benefits
        const s = (flagOwner === "A" ? 1 : -1) * 0.022;
        out.shift += s;
        out.signals.push({
          id: "chin", owner: _flagA ? "A" : "B",
          label: `Chin concern (${_flagA ? "A" : "B"} > 33y, KO-loss rate high)`,
          shift: s,
          source: "Kotrba 2023 (glass-jaw susceptibility over 33)",
          tone: "bad",
        });
      }
    }
    // 3) Rust > 12m (Fightnomics Ch.12)
    if (a.last_fight_days_ago != null || b.last_fight_days_ago != null) {
      const daysA = a.last_fight_days_ago ?? 0;
      const daysB = b.last_fight_days_ago ?? 0;
      const rustyA = daysA >= 365;
      const rustyB = daysB >= 365;
      if (rustyA !== rustyB) {
        const beneficiary = rustyA ? "B" : "A";
        const daysAbs = Math.abs(daysA - daysB);
        const s = (beneficiary === "A" ? 1 : -1) * UFC.weights.rust12moPlus * (daysAbs >= 730 ? 1.4 : 1.0);
        out.shift += s;
        out.signals.push({
          id: "rust", owner: rustyA ? "A" : "B",
          label: `Ring rust (${(rustyA ? daysA : daysB) >= 730 ? "≥2y" : "≥1y"} layoff)`,
          shift: s,
          source: "Fightnomics Ch.12 (ring rust >12 months)",
          tone: "bad",
        });
      }
    }
    // 4) UFC debut "Octagon jitters" (Fightnomics Ch.12)
    if (a.debut !== b.debut) {
      const beneficiary = a.debut ? "B" : "A";
      const s = (beneficiary === "A" ? 1 : -1) * UFC.weights.debutJitters;
      out.shift += s;
      out.signals.push({
        id: "debut", owner: a.debut ? "A" : "B",
        label: "Octagon jitters (UFC debut)",
        shift: s,
        source: "Fightnomics Ch.12 (debut win-rate deficit)",
        tone: "bad",
      });
    }
    return out;
  }

  function computeContextualPrior(context) {
    const out = { shift: 0.0, signals: [] };
    if (!context) return out;
    // Home-cage (Fightnomics Ch.12)
    if (context.homeOwner && context.homeOwner !== "neither" && context.homeOwner !== "none") {
      const owner = context.homeOwner;  // "A" or "B"
      const s = (owner === "A" ? 1 : -1) * 0.020;
      out.shift += s;
      out.signals.push({
        id: "home", owner,
        label: `Home-cage (${context.eventLocation || "local crowd"})`,
        shift: s,
        source: "Fightnomics Ch.12 (home-cage advantage ~2pts)",
        tone: "good",
      });
    }
    // Streaks (Fightnomics Ch.12: weak effect but directionally real)
    const streakA = context.winStreakA != null ? Math.sign(context.winStreakA) * Math.min(8, Math.abs(context.winStreakA)) : 0;
    const streakB = context.winStreakB != null ? Math.sign(context.winStreakB) * Math.min(8, Math.abs(context.winStreakB)) : 0;
    const sStreak = (streakA - streakB) * UFC.weights.winStreak;
    if (Math.abs(sStreak) >= 0.006) {
      out.shift += sStreak;
      if (streakA >= 3 && streakA > streakB) {
        out.signals.push({ id: "streak", owner: "A", label: `Win streak ${streakA}`, shift: sStreak, source: "Fightnomics Ch.12 (streak modest signal)", tone: "mild" });
      } else if (streakB >= 3 && streakB > streakA) {
        out.signals.push({ id: "streak", owner: "B", label: `Win streak ${streakB}`, shift: sStreak, source: "Fightnomics Ch.12 (streak modest signal)", tone: "mild" });
      }
    }
    // Weight miss
    const missA = Math.max(0, context.weightMissKgA || 0);
    const missB = Math.max(0, context.weightMissKgB || 0);
    if (missA !== missB) {
      const beneficiary = missA > missB ? "B" : "A";
      const delta = Math.abs(missA - missB);
      const s = (beneficiary === "A" ? 1 : -1) * UFC.weights.weightMissKg * delta;
      if (Math.abs(s) >= 0.004) {
        out.shift += s;
        out.signals.push({
          id: "weight", owner: missA > missB ? "A" : "B",
          label: `Weight miss ${delta.toFixed(1)} kg`,
          shift: s,
          source: "Fightnomics Ch.12 (missing weight correlates with loss)",
          tone: "bad",
        });
      }
    }
    // Tapology odds drift
    if (typeof context.oddsDriftA === "number" && Number.isFinite(context.oddsDriftA)) {
      const drift = clamp(context.oddsDriftA, -1, 1);
      const s = drift * 0.020;
      out.shift += s;
      if (Math.abs(s) >= 0.006) {
        out.signals.push({
          id: "drift", owner: drift >= 0 ? "A" : "B",
          label: `Odds drift ${drift >= 0 ? "A" : "B"}`,
          shift: s,
          source: "Tapology odds-movement proxy (broadly-directional)",
          tone: "mild",
        });
      }
    }
    return out;
  }

  /* =====================================================
   * SECTION: PERFORMANCE DELTA (8 FightMetric stats weighted)
   * ===================================================== */
  function performanceDelta(a, b) {
    // Returns { shift, zPerStat, signals[], missingTotal }
    const W = UFC.weights.perf;
    let shift = 0.0;
    const zPerStat = {};
    const signals = [];
    let missing = 0;
    const keys = Object.keys(UFC.stats);
    for (const k of keys) {
      const va = a[k];
      const vb = b[k];
      const { mu, sigma, label, desc } = UFC.stats[k];
      if (va == null || vb == null || !Number.isFinite(va) || !Number.isFinite(vb)) { missing++; zPerStat[k] = null; continue; }
      const w = W[k] || 0;
      // Compute z-of-difference in natural units. For strike-absorbed (sapm) the weight is negative
      // so delta = (va - vb) * w already gives correct direction.
      const delta = va - vb;
      const z = delta / Math.max(0.1, sigma);
      zPerStat[k] = z;
      const s = w * z;
      shift += s;
      if (Math.abs(z) >= 0.75) {
        const owner = (Math.sign(w) * z) >= 0 ? "A" : "B";
        signals.push({
          id: "perf_" + k,
          owner,
          label: `${label} ${(Math.sign(z) * delta >= 0 ? "+" : "")}${delta.toFixed(delta === Math.round(delta) ? 0 : 1)} ${k === "sapm" ? "absorbed" : ""}`,
          shift: s,
          source: `UFC Stats FightMetric: ${desc}`,
          tone: Math.abs(z) >= 1.5 ? "good" : "mild",
        });
      }
    }
    return { shift, zPerStat, signals, missing, total: keys.length };
  }

  /* =====================================================
   * SECTION: FULL PRIOR — compose every signal
   * ===================================================== */
  function fightnomicsPrior(fighterARaw, fighterBRaw, context) {
    const a = normalizeFighter(fighterARaw);
    const b = normalizeFighter(fighterBRaw);
    const reachRes = computeReachEdge(a, b);
    const stanceRes = computeStanceEdge(a, b);
    const ageRes = computeAgeAndRust(a, b);
    const ctxRes = computeContextualPrior(context || {});
    const perfRes = performanceDelta(a, b);

    const zRaw = reachRes.shift + stanceRes.shift + ageRes.shift + ctxRes.shift + perfRes.shift + UFC.weights.logRegBias;
    const z = clamp(zRaw,
      -UFC.weights.priorMaxShift,
       UFC.weights.priorMaxShift);
    const pA = clamp(sigmoid(z * 3.0), UFC.weights.clampMin, UFC.weights.clampMax); // *3 to scale logits → [~0.08..0.92]

    const signals = []
      .concat(reachRes.signals, stanceRes.signals, ageRes.signals, ctxRes.signals, perfRes.signals)
      .filter(Boolean)
      .map(s => Object.assign({ magnitude: s.shift || 0, detail: s.label || "" }, s))
      .sort((x, y) => Math.abs(y.shift || y.magnitude || 0) - Math.abs(x.shift || x.magnitude || 0));

    const missingStats = a._statsMissing + b._statsMissing; // 0..16 max
    const totalStats = a._statsTotal + b._statsTotal;
    const filledStatsCount = Math.max(0, (8 - a._statsMissing) + (8 - b._statsMissing));
    const perfZSum = Object.values(perfRes.zPerStat || {}).reduce((acc, v) => Number.isFinite(v) ? acc + v : acc, 0);

    // Edge-vs-market helper precomputed only when odds supplied via context
    let market = null;
    if (context && (context.oddsA > 1 || context.oddsB > 1)) {
      market = removeVigFromOdds(context.oddsA, context.oddsB);
    }

    const missingFeatures = (UFC ? 8 - (8 - a._statsMissing) : 0) + (UFC ? 8 - (8 - b._statsMissing) : 0);

    return {
      pA,
      pB: 1 - pA,
      z,
      zRaw,
      signals,
      market,
      diagnostics: {
        a: { age: a.age, apeIndexCm: a.apeIndexCm, statsFilled: 8 - a._statsMissing, stance: a.stance, record: a.wins != null ? [a.wins, a.losses, a.draws] : null },
        b: { age: b.age, apeIndexCm: b.apeIndexCm, statsFilled: 8 - b._statsMissing, stance: b.stance, record: b.wins != null ? [b.wins, b.losses, b.draws] : null },
        missingStats,
        totalStats,
        filledStatsCount,
        missingFeatures,
        missingFeaturesA: a._statsMissing,
        missingFeaturesB: b._statsMissing,
        totalFeatures: 16,
        missingSignalRateFighterA: a._statsMissing / 8,
        missingSignalRateFighterB: b._statsMissing / 8,
        logRegBiasUsed: !!UFC.weights.logRegBias,
        _perfZ: perfZSum,
      },
      breakdown: {
        reach: reachRes.shift,
        stance: stanceRes.shift,
        ageRust: ageRes.shift,
        contextual: ctxRes.shift,
        performance: perfRes.shift,
      },
      _normA: a,
      _normB: b,
      _perfZ: perfZSum,
    };
  }

  /* =====================================================
   * SECTION: EDGE VS MARKET + CONFIDENCE CALIBRATION
   * ===================================================== */
  function edgeVsMarket(userPriorA, marketPriorA, agreeCount, disagreeCount, fnPriorA) {
    // Returns { tier: NOISY|WEAK|GENUINE|STRONG, magnitude, agreeCount, disagreeCount, message }
    const u = clamp(isFinite(userPriorA) ? userPriorA : 0.5, 0.01, 0.99);
    const m = clamp(isFinite(marketPriorA) ? marketPriorA : 0.5, 0.01, 0.99);
    const userVsMarketPts = (u - m) * 100;   // in percentage points
    const fnVsMarketPts = isFinite(fnPriorA) ? (fnPriorA - m) * 100 : 0;

    // Fightnomics Ch.9: genuine edge requires (a) user differs from market by >8pts, AND (b) model signals point same direction
    const sameDirection = Math.sign(userVsMarketPts) === Math.sign(fnVsMarketPts) || Math.abs(fnVsMarketPts) < 2;
    const agreeSignalsAgree = agreeCount == null && disagreeCount == null ? true : (agreeCount >= 0 && disagreeCount >= 0 ? agreeCount >= disagreeCount : true);
    const aligned = sameDirection && agreeSignalsAgree;

    let tier = "NOISY";
    const magPts = Math.abs(userVsMarketPts);
    if (magPts > 8 && aligned)  tier = "GENUINE";
    if (magPts > 15 && aligned) tier = "STRONG";
    if (magPts <= 8 && !sameDirection) tier = "NOISY";
    if (magPts <= 8) tier = "WEAK";
    if (magPts > 8 && !aligned) tier = "WEAK";

    let message;
    const ptsTxt = `${userVsMarketPts >= 0 ? "on Fighter A" : "on Fighter B"} ${userVsMarketPts >= 0 ? "+" : ""}${userVsMarketPts.toFixed(1)} pts vs market`;
    if (tier === "NOISY") message = `Your estimate (${(u*100).toFixed(1)}%) lines up almost with no-vig market (${(m*100).toFixed(1)}%). No mathematical edge — this is the market's best guess. Fightnomics Ch.9 calls this "no edge".`;
    else if (tier === "WEAK") message = `You're ${ptsTxt}. Fightnomics signals are neutral or disagree with your direction. Either the edge is small, or you're betting against model consensus. Proceed cautiously.`;
    else if (tier === "GENUINE") message = `You're ${ptsTxt} and Fightnomics signals agree. This matches Fightnomics Ch.9's definition of a plausible edge (≥8pt gap with directional support). Kelly fraction is warranted.`;
    else if (tier === "STRONG") message = `Strong disagreement with market (${ptsTxt}) and all Fightnomics signals in same direction. Broadview/MMA Bets Vol 1 recommends smaller-than-full-Kelly sizing on high-conviction bets.`;

    return {
      tier,
      magnitude: magPts,
      userVsMarketPts,
      fnVsMarketPts,
      sameDirection,
      agreeCount, disagreeCount,
      message,
    };
  }

  /* =====================================================
   * SECTION: BROADVIEW STAKE SIZING FILTER
   * ===================================================== */
  function broadviewStakeWarning(rawKellyFraction, edgePercent, actualBetFractionOfBankroll) {
    // MMA Bets Vol 1 (Broadview): when edge is > 20% and you're betting > 1.5× Kelly, that's YOLO-equivalent.
    // Returns { warning, severity, message }
    const warnings = [];
    let severity = "none";
    if (!Number.isFinite(rawKellyFraction) || rawKellyFraction <= 0) {
      return { severity: "none", warnings: [], message: "No Kelly edge detected (negative or 0 stake)." };
    }
    if (actualBetFractionOfBankroll > rawKellyFraction * 2) {
      warnings.push("bet > 2× Kelly — ruin path consistent with YOLO");
      severity = "bad";
    } else if (actualBetFractionOfBankroll > rawKellyFraction * 1.25) {
      warnings.push("bet > 1.25× Kelly");
      severity = "mild";
    }
    if (edgePercent != null && edgePercent > 0.20 && actualBetFractionOfBankroll > rawKellyFraction * 1.2) {
      warnings.push("high-conviction (>20% EV) + oversize stake — Broadview recommends trimming to 0.5× Kelly here");
      severity = severity === "bad" ? "bad" : "mild";
    }
    if (warnings.length === 0) {
      return { severity: "none", warnings: [], message: "Sizing consistent with MMA Bets Vol 1 guidelines (≤ 1.25× Kelly)." };
    }
    return { severity, warnings, message: warnings.join(". ") };
  }

  /* =====================================================
   * SECTION: DISAGREEMENT / SIGNAL COUNTS (used for FN-alignment chips)
   * ===================================================== */
  function countSignalAgreement(fnPrior, userA_pick, userPriorA) {
    // userA_pick: "A" if user is staking on Fighter A in this leg, else "B"
    // Returns { agree: N, disagree: N, alignedDirection: bool }
    const fnLikes = fnPrior.pA >= 0.5 ? "A" : "B";
    const alignedDirection = fnLikes === userA_pick;
    let agree = 0, disagree = 0;
    (fnPrior.signals || []).forEach((sig) => {
      if (!sig.owner) return;
      const sigFavors = sig.owner; // "A" or "B"
      if (sigFavors === userA_pick) agree++;
      else disagree++;
    });
    if (userPriorA != null && Number.isFinite(userPriorA)) {
      const fnP = fnPrior.pA;
      const bothFavorA = userPriorA >= 0.5 && fnP >= 0.5;
      const bothFavorB = userPriorA <= 0.5 && fnP <= 0.5;
      if (bothFavorA || bothFavorB) agree++; else disagree++;
    }
    return { agree, disagree, alignedDirection, fnFavors: fnLikes };
  }

  /* =====================================================
   * SECTION: WEIGHT OVERRIDES (for advanced users, drift of 2013 book → modern)
   * ===================================================== */
  const WEIGHTS_OVERRIDES = {};
  function applyWeightsOverrides(overrides) {
    if (!overrides || typeof overrides !== "object") return;
    Object.assign(WEIGHTS_OVERRIDES, overrides);
    // apply to UFC.weights
    function merge(target, src) {
      for (const k of Object.keys(src)) {
        if (target[k] != null && typeof src[k] === "object" && !Array.isArray(src[k])) merge(target[k], src[k]);
        else if (src[k] != null) target[k] = src[k];
      }
    }
    merge(UFC.weights, overrides);
  }

  /* =====================================================
   * SECTION: TAPOLOGY odds-drift parser (simple — user pastes text)
   * ===================================================== */
  function tapologyOddsDriftPrior(text) {
    // Converts user-observed odds movement text to ±0.02 logit.
    // Expects freeform like: "A drifted from +110 to -120 overnight" or "B from 2.10 to 1.95".
    if (!text || typeof text !== "string") return 0;
    const t = text.toLowerCase();
    let aShift = 0;
    // directional language
    if (/drifted (in|toward|for) a|a (moved|drifted).*(fav|shorter|-|lower|down)/.test(t)) aShift += 0.012;
    if (/drifted (out|against|for) b|b (moved|drifted).*(fav|shorter)/.test(t)) aShift -= 0.012;
    if (/steam move on a|big money on a/.test(t)) aShift += 0.008;
    if (/steam move on b|big money on b/.test(t)) aShift -= 0.008;
    return clamp(aShift, -0.02, 0.02);
  }

  /* =====================================================
   * EXPORT
   * ===================================================== */
  const FN = {
    UFC,
    WEIGHTS_OVERRIDES,
    applyWeightsOverrides,
    /* Helpers */
    normalizeFighter,
    fuzzyFighterLookup,
    dice,
    ageFromDob: _ageFromDob,
    /* Vig removal + market (MMA Bets Vol 1) */
    removeVigFromOdds,
    oddsToRawImplied,
    marketImpliedFromOdds,
    /* Per-signal scorers */
    computeReachEdge,
    computeStanceEdge,
    computeAgeAndRust,
    computeContextualPrior,
    performanceDelta,
    /* Full prior */
    fightnomicsPrior,
    /* Edge classification */
    edgeVsMarket,
    countSignalAgreement,
    /* Broadview sizing filter */
    broadviewStakeWarning,
    /* Tapology proxy */
    tapologyOddsDriftPrior,
    /* Source references (for UI chip tooltips) */
    _sources: {
      fightnomics: "Fightnomics — Kuhn & Crigger (2013)",
      mmaBets:    "MMA Bets Vol 1 — Broadview (odds framework)",
      ufcStats:   "UFC Stats official / FightMetric (via Kaggle 2024 dataset)",
      kaggle:     "Kaggle UFC Fighters Statistics 2024 / Dabbert 2021 / namiqi 2026",
      sherdog:    "Sherdog / Tapology historical data (via Kaggle snapshots)",
      kotrba2023: "Kotrba 2023 — glass jaw over 33y",
      namiqi2026: "namiqi 2026 — pre-fight UFC winner LogReg baseline (0.76 ROC-AUC)",
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = FN;
  global.FN = FN;
})(typeof window !== "undefined" ? window : globalThis);
