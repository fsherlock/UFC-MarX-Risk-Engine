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
      const decoded = jwt.verify(tok, process.env.SUPABASE_JWT_SECRET, { algorithms: ["HS256", "RS256"] });
      if (decoded && decoded.sub) return decoded.sub;
    } catch (_) { /* invalid JWT => fall through to anon */ }
  }
  return "anon_" + tok.slice(0, 8);
}

router.get("/", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const cards = await db.listCards(uid);
    res.json({ storage: db.MODE, userId: uid, count: cards.length, cards });
  } catch (err) {
    res.status(500).json({ error: "LIST_FAILED", message: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const token = require("../db.js").newId();
    const saved = await db.saveCard(uid, req.body || {}, token);
    res.status(201).json({ storage: db.MODE, card: saved, shareUrl: `/cards/${saved.share_token || token}` });
  } catch (err) {
    res.status(500).json({ error: "SAVE_FAILED", message: err.message });
  }
});

router.get("/share/:token", async (req, res) => {
  try {
    const c = await db.getCardByShare(req.params.token);
    if (!c) return res.status(404).json({ error: "NOT_FOUND", message: "share token invalid or expired" });
    res.json({ storage: db.MODE, card: c });
  } catch (err) {
    res.status(500).json({ error: "SHARE_FAILED", message: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const c = db.MODE === "SUPABASE"
      ? await db.getCardByIdSupabase(req.params.id, uid)
      : db.getCardByIdMemory(req.params.id, uid);
    if (!c) return res.status(404).json({ error: "NOT_FOUND", message: "card not found" });
    res.json({ storage: db.MODE, card: c });
  } catch (err) {
    res.status(500).json({ error: "GET_ONE_FAILED", message: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const body = req.body || {};
    const patch = {};
    if (typeof body.note === "string") patch.note = body.note;
    if (body.payload !== undefined) patch.payload = body.payload;
    if (!("note" in patch) && !("payload" in patch)) {
      return res.status(400).json({ error: "BAD_REQUEST", message: "nothing to patch: provide note or payload" });
    }
    const c = db.MODE === "SUPABASE"
      ? await db.updateCardSupabase(req.params.id, uid, patch)
      : db.updateCardMemory(req.params.id, uid, patch);
    if (!c) return res.status(404).json({ error: "NOT_FOUND", message: "card not found" });
    res.json({ storage: db.MODE, card: c });
  } catch (err) {
    res.status(500).json({ error: "PATCH_FAILED", message: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const uid = currentUserId(req);
    const ok = db.MODE === "SUPABASE"
      ? await db.deleteCardSupabase(req.params.id, uid)
      : db.deleteCardMemory(req.params.id, uid);
    if (!ok) return res.status(404).json({ error: "NOT_FOUND", message: "card not found" });
    res.json({ storage: db.MODE, deleted: true });
  } catch (err) {
    res.status(500).json({ error: "DELETE_FAILED", message: err.message });
  }
});

module.exports = router;
