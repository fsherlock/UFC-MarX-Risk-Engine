/* ==========================================================
 * UFC MarX Risk Engine — Tier 1 Backend
 * src/index.js  — Express server entry (Vercel Functions-compatible)
 * ========================================================== */
"use strict";
require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const calculateRoutes = require("./routes/calculate.js");
const cardsRoutes = require("./routes/cards.js");
const betsRoutes = require("./routes/bets.js");
const authRoutes = require("./routes/auth.js");
const scheduleRoutes = require("./routes/schedule.js");
const db = require("./db.js");

const PORT = Number(process.env.PORT) || 8787;
const corsOriginCsv = (process.env.CORS_ORIGINS || "*,http://localhost:8080,http://localhost:8081").trim();
const corsList = corsOriginCsv.split(",").map(s => s.trim()).filter(Boolean);

const app = express();

// -------------------------- Middleware --------------------------
app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: false }));
if (corsList.includes("*")) {
  app.use(cors());
} else {
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin || corsList.includes(origin)) return cb(null, true);
      // Allow localhost variants by prefix
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin || "")) return cb(null, true);
      cb(new Error(`CORS blocked origin: ${origin}. Add it to CORS_ORIGINS in backend/.env`), false);
    },
    credentials: true,
  }));
}

// -------------------------- Root health + discovery --------------------------
app.get("/api", (req, res) => {
  res.json({
    name: "UFC MarX Risk Engine — Backend",
    version: "0.1.0-tier1",
    storage: db.MODE,
    docs: [
      "GET  /api                         <- API discovery (this page)",
      "GET  /api/calculate/health        <- calculation service health",
      "POST /api/calculate               <- returns { strategies: {kelly,equal,yolo,singles}, fights, engineMeta }  [IDENTICAL to browser]",
      "POST /api/calculate/fight-probabilities <- 3-mode prob resolver user/fn/market with fallback chain",
      "GET  /api/auth/me                 <- backend config + storage mode + which features are ON",
      "POST /api/auth/login              <- Supabase auth demo stub (no real users)",
      "GET  /api/cards                   <- list saved cards for user (Requires: Bearer JWT for non-anon)",
      "POST /api/cards                   <- save a card, get share token back",
      "GET  /api/cards/share/:token      <- public permalink shared card",
      "GET  /api/bets?card_id=           <- list bets, filtered by card (optional)",
      "POST /api/bets                    <- record a bet on a saved card (stake, fighter, outcome)",
      "PATCH /api/bets/:id/settle        <- mark outcome WIN/LOSS/PUSH + settled_at timestamp",
      "DELETE /api/bets/:id              <- remove bet record",
      "GET  /api/schedule/upcoming       <- UFC schedule (STUB demo until ODDS_API_KEY set)",
      "GET  /api/schedule/odds/:eventId  <- live odds per event (STUB demo)",
    ],
    storage_config_warnings: [
      db.isSupabase ? "✅ Using Supabase Postgres (persistent)"
                    : "⚠️  In-Memory Storage (cards DELETED on restart — paste SUPABASE_URL + SERVICE_ROLE_KEY into backend/.env for persistence)",
      process.env.ODDS_API_KEY ? "✅ Odds Feed API key configured"
                                : "ℹ️  Odds feed is STUB ONLY — paste ODDS_API_KEY into backend/.env for real bookmaker lines"
    ],
    time: new Date().toISOString(),
  });
});

// -------------------------- Share permalink short URL --------------------------
// IMPORTANT: mount BEFORE static middleware & before API routes NOT static dir (cards/:token vs /index.html ambiguous)
// GET /cards/:shareToken → redirects to static frontend with ?share=TOKEN
app.get("/cards/:token", (req, res) => {
  const token = encodeURIComponent(req.params.token);
  res.redirect(302, `/?share=${token}`);
});

// -------------------------- Route mounts --------------------------
app.use("/api/calculate", calculateRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/cards", cardsRoutes);
app.use("/api/bets", betsRoutes);
app.use("/api/schedule", scheduleRoutes);

// -------------------------- Static frontend (optional, serves UFC MarX
//                              static index.html for single-server deployments --------------------------
const STATIC_DIR = path.resolve(__dirname, "..", "..");
app.use("/", express.static(STATIC_DIR, {
  extensions: ["html"],
  index: false,
  setHeaders(res) { res.setHeader("X-Static-Served-By", "ufc-marx-backend"); }
}));
app.get("/", (_req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));

// -------------------------- Error handler --------------------------
app.use((err, _req, res, _next) => {
  const status = err.status || (err.message?.includes("CORS") ? 403 : 500);
  res.status(status).json({ error: "SERVER_ERROR", message: err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("=".repeat(70));
    console.log("  UFC MarX Risk Engine  —  Tier 1 Backend");
    console.log("  HTTP on http://localhost:" + PORT + "/api");
    console.log("  Storage: " + db.MODE +
      (db.isSupabase ? " ✅ persistent" : " ⚠️  IN-MEMORY — cards wipe on restart"));
    console.log("  Odds   : " + (process.env.ODDS_API_KEY
      ? "Live (" + (process.env.ODDS_API_PROVIDER || "configured") + ")"
      : "STUB DEMO (set ODDS_API_KEY in backend/.env)"));
    console.log("  Docs   : GET " + "http://localhost:" + PORT + "/api");
    console.log("=".repeat(70));
  });
}

module.exports = app;
