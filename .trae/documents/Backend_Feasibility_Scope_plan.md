# UFC MarX Risk Engine — Backend Feasibility & Scope Plan
> `/plan DO WE HAVE / DO WE NEED / WHAT IT SERVES / CAN WE

## 1. Repo Research Conclusion — DO WE HAVE A BACKEND TODAY?

**Answer: NO. 100% Static, client-side only.**

Evidence from repo scan:
```
ufc/ (cwd)
  ├── index.html                 ← ENTRY POINT ONLY
  ├── manifest.json          ← PWA manifest (no backend)
  ├── css/style.css
  ├── data/fighter_stats_bundle.js   ← static seed bundle (308 fighters, schema v1.0)
  ├── js/
  │   ├── app.js         ← risk engine (DOM, all logic, MC sim)
  │   ├── fightnomics.js  ← pure JS math module (window.FN, no side effects)
  │   └── data.js         ← fightersDB + fighterStatsMap (static fighter names)
  ├── scripts/regen_bundle.js ← Node ONE-OFF script (NOT a server)
  ├── README.md            ← Says "static site open index.html / python -m http.server 8080"
  └── .trae/documents/
```

**Absent (no backend exists, no deployment config, no package.json, no requirements.txt, no server.py / api/ functions/ Dockerfile / vercel.json / .env**

Everything today runs 100% in the user's browser. No network calls at runtime except:
* (Optional) TheSportsDB public thumbnail-only demo key = "3" (for thumbnail fetching)
* No fighter data loaded via `<script>` tags at page load — no fetch/XHR calls for calculations

---

## 2. DO WE NEED A BACKEND? Two Scenarios

### 2.1 Scenario A — Static is Sufficient (current architecture is correct choice

The following features work perfectly today with the STATIC approach. **No backend needed ever** IF YOU:

| Use-case | How Static Works
|---|---
 Kelly/EV/Variance + Monte Carlo | ✅ `app.js` has all code, runs in browser in a few ms
 Fightnomics scoring vig removal, edge vs market, broadview sizing  ✅ `fightnomics.js pure math
 Fight bios + UFC Stats FightMetric | ✅ `fighter_stats_bundle.js seeded, regenerated offline
 Autocomplete + fuzzy lookup | ✅ Dice coeff browser memory lookup in-memory
 Odds toggle American ↔ Decimal odds format
 Calibrate/Blend buttons, Tale of the Tape, per-pick show/hide, strategy alignment chips, Fightnomics signal chips
 Export PDF export (jsPDF/html2canvas CDN import)
 Works offline / PWA manifest ✅ manifest.json + no server
 Deploy to GitHub Pages / S3 / Cloudflare Pages / Netlify Drop just drag and drop folder
 No user accounts, no saved fights saved state local storage only

**Static is mathematically honest:**
* No API key ever hits leave user's device calculation (zero drift from your device.
* Zero running costs $0
* No ToS breach Tapology/Sherdog live scraping happens
* **Auditable all deterministic seed bundle deterministic
* Kelly + MC are run client-side reproducible across machines.

---

### 2.2 Scenario B — YES, We Need a Backend (if/when You Want any of these 10 real features

The following features CANNOT run correctly in pure static client-only world:

```
Priority · Feature · Why requires Backend?
 ├─ 🔴 P0 —   #1 Feature: Save fights/cards state across devices ("my parlay card" · Needs persistent DB
 │                                         (Local storage is per device only. No sync
 ├─ 🔴 P0 —    #2 Feature: User accounts (email/Sign in wagers 100% client only)
 ├─ 🔴 P0 —   #3 Feature: Historical backtesting: "Did my 2024 bets ROI tracker
 │                                   → Need to compute 2022 bets stored DB + odds
 │
 ├─ 🟠 P1 —   #4 Live UFC odds feed real-time API pull live odds (bookmakers change line movement
 │                                            (CORS + paid Odds-JS only from browser live-odds APIs)
 ├─ 🟠 P1 — #5 Automated weekly UFC schedule + results settlement)
 │                                  API with results after event)
 │
 ├─ 🟠 P1 — #6 Actual model retraining / predictions service: fightnomics + Kaggle CSVs 4,000 fight retrain LogReg/XGB monthly fresh coefficients
 │                                        (Browser can't read CSVs efficiently)
 ├─ 🟡 P2  #7 Shared cards" → permalink sharing a card URL (Sharable link parlay picks link parlay + your bets
 │
 ├─ 🟡 P2 —  #8 Notifications email/SMS alert when odds crosses vig opens value threshold line
 │
 ├─ 🟡 P2  #9 Advanced historical model accuracy leaderboard Kelly ROI leaderboard community leaderboard)
 │
 └─ 🟢 P3 — #10 Mobile native apps + native app backend auth sync mobile via REST

Any of → YES → Backend becomes justified. If none apply → Keep static. STAY STATIC.

---

## 3. WHAT WILL A BACKEND SERVE? 3-Tiered Arch Options

3 Architecture tiers of backend. Each tier adds new services.

### Tier 1: Minimal Node.js Express Minimal Node Express/Serverless Functions (Fastest path to go live)
```
WHAT IT SERVES → 6 routes minimum):

  POST /api/auth → REST
  ├── 1. SaveCard POST /api/cards → SaveCard user card to Postgres/Supabase
  ├── 2. GET /api/cards/:userId → get user saved cards list
  ├── 3. POST /api/bets → Save bet tracking (results/wager/settle
  ├── 4. GET /api/odds?eventId → CORS proxy odds feed (The
  │                      Odds / OddsJam/OddsJam via server key
  ├── 5. GET /api/schedule/upcoming → UFC schedule + results (from UFC / Esportstapestry
  ├── 7. POST /api/calculate → Same Kelly calc (optional — reidentical math in fightnomicsNode bundle run backend (same coefficients so results
  └── 8. GET /api/cards/share/:shareId → Permalinked public sharing card

🗂 Tech Stack Minimum:
  • Node.js + Express (or tRPC for type-safety
  • Supabase Postgres DB OR Railway Postgres (cheapest $5/mo
  • JWT cookies for auth
  • Deploy: Vercel Functions (auto free serverless) or Railway Fly.io
```

**Cost & Effort**
*  $500-1200 lines code total approx.
* $5-20/mo hosting (Supabase free tier for 50k users/month

---

### Tier 2: Medium REST + Kaggle Data Pipeline (adds ML + Fightnomics retraining
```
WHAT IT ADDS vs Tier1:
  ├── 9. POST /api/predict/:fighterA/fighterB → Real FightnomicsPrior retrained coefs
  ├── 10. GET /api/fighters/search?q= → autocomplete 4000 fighters (not just 308 seeds
  ├── 11. POST /api/model/retrain → (cron weekly: ingest Kaggle CSVs → retrain LogReg/XGB
  │                                 → Update coefficients pushed to bundle
  └── 12. GET /api/fighters/:name → TaleTape full bio + full bio stats history from UFCStats live from bundle new endpoint.

Tech stack: + Python FastAPI microservice alongside Node (pure ML or Node + @tensorflow/tfjs-node
Pipeline: node scripts/regenerate bundle + upload to bundle fighter DB every Sunday
```

---

### Tier 3: Full Backend — Real Features Notifications, realtime + mobile API + odds streaming

```
Adds vs Tier2:
  13. 🔔 Webhooks / SMS/ email → SES/Twilio → notif
  14. ⚡️ WebSocket odds → 3-way calcs live feed in real time
  15. 📱 Push notifications via Expo
  16. 👥 Friends + leaderboards.
  17. 💰 Affiliate program —  tracking.
  18. Stripe payments $ pro (Pro tier: advanced backtest

Stack + Bull worker workers cron jobs
```

---

## 4. CAN WE DO IT? (Feasibility = YES, path is green lights:

Feasibility Breakdown for the existing codebase:

| Component | Reusability from | Grade | Notes
|---|---|---|---
| fightnomics.js calculations | 100% drop in Node/FastAPI → same math, no rewrite | ✅ A+ | Same FN module pure (same exact coefficients → zero migration
| Kelly + Strategies render | Strategy calculator 60% · ✅ A- Same already pure functions — computeKelly, MC, equalStakeYOLO already → Move to backend services/fn module)
| bundle data schema | 100% usable (just add to Postgres rows in Supabase ✅ A | fighter_stats_bundle.js fighter_stats table
| Auth | Nothing built → New  build | ⚠️ New | Supabase Auth, Lucia, Auth.js easy
| Frontend UI tweaks | Minor ✅ B+ | add /login / saved /dashboard need new pages | Save card → calls
| Odds feed | None → build | ⚠️ New integration OddsJam or similar ~$99/mo minimum)
| Deployment | zero → Vercel + Supabase zero-config deploy. ✅ A+

Total timeline estimate:
  • MVP (Tier 1) = 5 – 8 dev days
  • Tier1 + Tier 2 features model retrain Kaggle ingest = 12 – 18 dev days

---

## 5. Implementation Step-by-Step Plan (if approved:

### Phase 0: Setup scaffolding

p_new files
```
backend/
├── package.json
├── src/
│   ├── index.js      # Express entry
│   ├── services/
│   │   ├── fightnomics.js → COPY FROM js/fightnomics as pure module)
│   │   ├── strategies.js  (from app.js functions to pure functions
│   │   └── oddsProxy.js
│   ├── routes/
│   │   ├── auth.js cards.js bets.js  calculate.js oddsfeed schedule
│   └── db.js (pg-promise
├── supabase/migrations/
└── vercel.json
Frontend → Refactor fetch calls to endpoints + Login/Saved via React/Next.js or continue static + fetch
```

Phase 1: Pure Extract pure services → calculate.js calculate backend route
- Move kellyFraction / computeStrategies functions → pure + shared Node
- Add POST /api/calculate + returns identical results browser today's browser → parity)

Phase 2: Auth Saved
- Supabase auth
- Add saved cards / Save button on UI on saved dashboard page

Phase 3+: Odds feed / UFC schedule API / Retrain service

---

## 6. Risks & Considerations
```
Risk 1: Odds API costs — minimum $99/mo OddsJam/OddsJam → Mitigation: keep static fallback for odds manual odds enter manual entering
Risk 2: ToS Scraping Tapology UFC Stats → Mitigation: only Kaggle CSVs + licensed via provider no scraping
Risk 3: Scope creep —  Mitigation: ship MVP Tier 1 first
Risk 4: Auth security → Mitigation Supabase Auth/Auth.js enterprise Auth.js
Risk 5: Math drift between backend calculations + browser parity → Mitigation: same fightnomics.js dual-use package npm internal
Risk 6: Costs running → Mitigation serverless Vercel free tier Supabase free tier for first 1k users
```

## 7. Recommendation / Go-No-Go Criteria
```
✅ RECOMMEND KEEP STATIC if:
   → You just using tool → today works offline, costs zero

✅ RECOMMEND BUILD BACKEND if:
   → Any of P0 features (save sync mobile; accounts; bet tracking historical)
   → You want commercial product community sharing

BUILD ORDER if backend go approved:
  Step 1: Math service parity (fightnomics + strategies in Node)
  Step 2: Auth + saved cards + permalink
  Step 3: odds feed proxy + schedule
  Step 4: pipeline retrain accuracy
  Step 5: mobile + notif
```

## 8. Existing References in Code
* Static Math: [fightnomics.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/fightnomics.js) (pure → can be copy-pasted in Node as-is
* Kelly Engine: [app.js L1537 computeFightProbabilities](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L1537-L1575)
* Bundle seed generation: [regen_bundle.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/scripts/regen_bundle.js)
* README static instructions: [README.md](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/README.md)
