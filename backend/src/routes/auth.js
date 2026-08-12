"use strict";
const express = require("express");
const router = express.Router();
const db = require("../db.js");

router.post("/login", (req, res) => {
  const provider = req.body?.provider || "email";
  res.json({
    provider,
    backend: db.MODE,
    note: db.isSupabase
      ? "Use Supabase JS client on frontend: supabase.auth.signInWithPassword / signInWithOAuth"
      : "DEMO ONLY (MEMORY MODE). No real auth. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + SUPABASE_JWT_SECRET in .env to enable Supabase Auth (email, Google, Apple)."
  });
});

router.post("/logout", (req, res) => res.json({ ok: true }));
router.get("/me", (req, res) => {
  res.json({
    authenticated: db.isSupabase,
    storage: db.MODE,
    features: {
      saveCards: true,
      sharePermalinks: true,
      betTracking: true,
      oddsFeed: process.env.ODDS_API_KEY ? true : false,
      realOddsProvider: process.env.ODDS_API_PROVIDER || "none (stub)",
    },
  });
});
module.exports = router;
