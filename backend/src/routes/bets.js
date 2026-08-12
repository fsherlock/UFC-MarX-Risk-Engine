"use strict";
const express = require("express");
const router = express.Router();
const db = require("../db.js");
const jwt = (() => { try { return require("jsonwebtoken"); } catch(_) { return null; } })();

function currentUserId(req) {
  const header = req.headers.authorization || "";
  const tok = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!tok) return "anon";
  if (jwt && process.env.SUPABASE_JWT_SECRET) {
    try {
      const d = jwt.verify(tok, process.env.SUPABASE_JWT_SECRET, { algorithms: ["HS256", "RS256"] });
      if (d && d.sub) return d.sub;
    } catch (_) { /* fallthrough */ }
  }
  return "anon_" + tok.slice(0, 8);
}

router.get("/", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const cardFilter = req.query.card_id ? req.query.card_id : null;
    let bets = await (db.isSupabase ? db.listBetsSupabase(uid, cardFilter) : Promise.resolve(db.listBetsMemory(uid, cardFilter)));
    // Support both storage paths via unified helper fallback:
    if (typeof bets === "undefined" || bets === null) bets = [];
    res.json({ storage: db.MODE, userId: uid, count: bets.length, bets });
  } catch (err) {
    res.status(500).json({ error: "LIST_BETS_FAILED", message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const bet = req.body || {};
    // Enforce basic shape
    if (!bet || typeof bet !== "object") return res.status(400).json({ error: "BAD_BET", message: "bet payload required" });
    const saved = await db.saveBet(uid, bet);
    res.status(201).json({ storage: db.MODE, bet: saved });
  } catch (err) {
    res.status(500).json({ error: "SAVE_BET_FAILED", message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const uid = currentUserId(req);
    let bet = null;
    if (db.isSupabase && db.getBetByIdSupabase) bet = await db.getBetByIdSupabase(req.params.id, uid);
    else if (db.getBetByIdMemory) bet = db.getBetByIdMemory(req.params.id, uid);
    if (!bet) return res.status(404).json({ error: "NOT_FOUND", message: "bet id invalid" });
    res.json({ storage: db.MODE, bet });
  } catch (err) {
    res.status(500).json({ error: "FETCH_BET_FAILED", message: err.message });
  }
});

router.patch("/:id/settle", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const raw = (req.body?.outcome ?? "");
    const outcome = (typeof raw === "string") ? raw.trim().toUpperCase() : "";
    const allow = ["WIN", "LOSS", "PUSH", ""];  // empty = unset outcome (reset to pending)
    if (!allow.includes(outcome)) {
      return res.status(400).json({ error: "BAD_OUTCOME", message: "outcome must be WIN, LOSS, PUSH, or '' (to reset)" });
    }
    let updated = null;
    if (outcome === "") {
      if (db.isSupabase && db.unsettleBetSupabase) updated = await db.unsettleBetSupabase(req.params.id, uid);
      else if (db.unsettleBetMemory) updated = db.unsettleBetMemory(req.params.id, uid);
    } else {
      if (db.isSupabase && db.settleBetSupabase) updated = await db.settleBetSupabase(req.params.id, uid, outcome);
      else if (db.settleBetMemory) updated = db.settleBetMemory(req.params.id, uid, outcome);
    }
    if (!updated) return res.status(404).json({ error: "NOT_FOUND", message: "bet id invalid or no auth" });
    res.json({ storage: db.MODE, bet: updated });
  } catch (err) {
    res.status(500).json({ error: "SETTLE_FAILED", message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const uid = currentUserId(req);
    let ok = false;
    if (db.isSupabase && db.deleteBetSupabase) ok = await db.deleteBetSupabase(req.params.id, uid);
    else if (db.deleteBetMemory) ok = db.deleteBetMemory(req.params.id, uid);
    if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "bet id invalid or no auth" });
    res.json({ storage: db.MODE, deleted: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: "DELETE_FAILED", message: err.message });
  }
});

module.exports = router;
