"use strict";
const express = require("express");
const router = express.Router();
const { computeAllStrategies, computeFightProbabilities } = require("../services/strategies.js");

router.get("/health", (req, res) => {
  res.json({ ok: true, service: "ufc-marx/calculate", time: new Date().toISOString() });
});

router.post("/", (req, res) => {
  try {
    const payload = req.body || {};
    const result = computeAllStrategies(payload);
    res.setHeader("X-Calc-Engine", "marx-t1-identical");
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: "CALCULATION_FAILED", message: err.message });
  }
});

router.post("/fight-probabilities", (req, res) => {
  try {
    const fight = req.body?.fight;
    const mode = req.body?.probMode || "user";
    if (!fight || !fight.fighters) return res.status(400).json({ error: "missing fight.fighters" });
    const probs = computeFightProbabilities(fight, mode);
    res.status(200).json({ probMode: mode, fighters: probs });
  } catch (err) {
    res.status(400).json({ error: "PROBABILITY_FAILED", message: err.message });
  }
});

module.exports = router;
