# UFC MarX Risk Engine — "Organize All" Master Plan
_(Situation: Static frontend + Tier 1 backend built, Supabase (eu-west-1 jlizbewyzydsaqdyopnq) live. User wants to know: "Organize EVERYTHING next — prioritise, document, deploy, close gaps, surface bet tracking, live odds, clean up drift, test, deploy.

## 1. Repo Research — Current State Snapshot

### 1.1 What's WORKING ✅
| Area | Status | Smoke proof |
|------|--------|------------|
| Static app (index.html + js/app.js) | 100% functional | 7 bugfixes applied, probability 3-way drive split working (user/FN/market + fallback chain + normalize) |
| Fightnomics 25-feature prior | Identical browser ≡ backend | FN.fightnomicsPrior(Adesanya, DuPlessis 2.1/1.79) = 0.7109 exactly on both sides |
| Broadview vig removal + no-vig market probs | Working (stub) | MMA Bets 1/oA/1/oB weighting + vig% column |
| Kelly 0.25× Fractional with overflow rescaling | Working | Stake sum > BR linearly rescaled |
| Parlay cap 5 = 32 full-enforce + truncate by Kelly | Working | truncateParlaysByKelly(1000) safety |
| Monte Carlo 10000-trial seeded PRNG (mulberry32) | Working | Seeded deterministic: same seed same P5/P95 identical |
| Backend Tier 1 API | 43/43 HTTP assertions passed | calculate · auth · cards (8 routes |
| Supabase Postgres live (eu-west-1) | 24/24 live assertions, applied migration 0001 | cards/bets RLS + share_token public read service_role bypass |
| Save Card + Saved Dashboard UI | Works on localhost | Toast with backend on port 8787 |
| ?share=TOKEN autoload on page init | Works on localhost fetch GET /share route | hydrateFromSavedPayload rewrites DOM |
| FN math parity invariant (browser ≡ server) | smoke_calculate.js 60/60 | |

### 1.2 What's MISSING or BROKEN 🔴
| Priority | Gap | Impact |
|----------|-----|--------|
| P0 | `README.md` says "static client only · NO backend NO npm" — OUT OF DATE | New users can't figure out dual mode |
| P0 | Backend `package.json` `check:all` script — Windows cmd FOR syntax — won't run in PowerShell 5 | `npm.cmd run check:all fails silently broken |
| P0 | No root package.json at ROOT | No top-level `npm run dev:all` one command to spin static+backend |
| P1 | `bets` routes + DB schema exist but ZERO frontend UI for "settle a bet / mark WIN/LOSS/PUSH | Users save card → save bet → track ROI. Currently impossible in UI |
| P1 | `schedule.js GET /upcoming` STUB_DEMO odds | Hardcoded UFC312 only no real feed |
| P1 | Share URL `http://localhost:8787?share=abc` — no client router; missing share permalink doesn't deep link | Share toast points to statically hosted site |
| P1 | No CORS strict mode — CORS_ORIGINS=* works but not secure for deploy | Preflight needs tightening needed before live domain |
| P2 | FN bundle drift: `js/fightnomics.js` vs `backend/src/services/fightnomics.js` are DUPLICATE files | We copy paste when any edit. No build step or symlink check. |
| P2 | fighter_stats_bundle.js same drift (2 copies) | Same. |
| P2 | No favicon.ico / no icons in root (manifest references UFC logo) | PWA manifest has it. No offline cache SW |
| P2 | No Open Graph meta tags / OG share preview for share links on twitter/whatsapp | Paste share URL → no card preview |
| P2 | Probability mode `market` drive when odds are American odds; no way to see vig removed line → if odds aren't decimals | Fine; but calc engine always calc but backend is. |
| P3 | No test runner / Jest / Vitest / Mocha | Smoke scripts ad-hoc only, no CI pipeline failsafe |
| P3 | Backend error handler — no stack traces leak internal routes | 404 handled but calculate heavy → 500 without stack in production |
| P3 | PWA manifest exists but no Service Worker registration code | Not installed app cache |
| P3 | No bundle minification / build step | OK for MVP — static but deploy fine |
| P3 | Migrate script `migrate_up.js` tells user "paste into SQL editor" — no automated DDL via REST (correct Supabase REST blocks DDL — not a bug) | User already applied via MCP supabase_apply_migration ✅ |

### 1.3 Deployment Target Landscape — file layout problems
```
ufc/                       ← "Root has no package.json. Has README static server static frontend (index.html, js/, css/)
  backend/                 ← separate package.json. Runs on 8787, also serves static root via express.static
  data/ & scripts/          ← regen_bundle.js + fighter_stats_bundle.js
```

## 2. Proposed Final Architecture
### 2.1 Dual-Mode Product (preserve user choice)
```
MODE A: Static zero-backend (file:// or any static host → continue working)
MODE B: Backend-driven via backend/.env SUPABASE → persistent + share + bets
```

## 3. Organize-All: 7 Workstreams — order of execution
### WS-A 🏗️ — Repo hygiene +  🏗️
### WS-🔌 — Close P0 docs (ready for first deploy
### WS-C 🧪 — Unified one command start
### WS-D 💰 — Bet-tracking UI Tier 1.5 (close bets loop)
### WS-E 🎯 — Live Odds Feed Tier 2 (the-odds-api integration)
### WS-F 🌐 — Deploy dual-host (Vercel Serverless + IGA Pages Static)
### WS-G 📊 — Tests (addressed by Jest + GitHub Actions

## 4. Steps — Step-by-step Breakdown of Files to EDIT

### ⚪ WS-A. Repo Hygiene (zero logic change — structural)
1. **DELETE duplicates** (ensure these files are byte-identical every release.
   - `js/fightnomics.js` ↔ `backend/src/services/fightnomics.js` → assert equal, then symlink? Can't Windows symlinks easily dev server doesn't copy; build step but copy is fine; add postinstall copy in ROOT `package.json`; also for `data/fighter_stats_bundle.js` ↔ `backend/src/services/fighter_stats_bundle.js`.
2. **Root `.gitignore`** at root (create): `backend/node_modules` + `backend/.env` + `node_modules` `.DS_Store`
3. **`backend/.gitignore`** new (currently missing if exists)
4. **Root `package.json` at ROOT**:
   ```
   {
     "name": "ufc-marx",
     "version": "1.0.0-tier1",
     "scripts": {
       "install:all": "npm install && cd backend && npm install",
       "dev:static": "npx http-server . -p 8080",
       "dev:backend": "cd backend && npm run dev",
       "dev": "concurrently -n STATIC,BACK -c blue,magenta \"npm:dev:static\" \"npm:dev:backend\"",
       "smoke:all": "cd backend && npm run smoke",
       "lint": "node --check js/app.js && node --check js/fightnomics.js && cd backend && npm run check:all"
     },
     "devDependencies": { "concurrently": "^8.2.2", "http-server": "^14.1.1 }
   }
   ```
5. **Fix backend check:all → PowerShell-safe:
   ```
   "check:all": "node --check src/index.js ; node --check src/db.js ; node --check src/services/fightnomics.js ; node --check src/services/strategies.js ; node --check src/routes/calculate.js ; node --check src/routes/cards.js ; node --check src/routes/auth.js ; node --check src/routes/schedule.js ; node scripts/smoke_calculate.js"
   ```

### ⚪ WS-B. Documentation — close for share permalinks deep-linking)
```
1. **`/cards routes mount share → root `:8787/?share=$TOKEN` rewrite in index.html `cards routes  (currently hydrate frontend-only /?share token works via `window.location.search`. OK ✅)
2. **`/cards/:shareToken —  404 not rewrite backend/src/index.js — `app.get('/cards/:token', (req, res) => { res.redirect(`/?share=${req.params.token}`); })`;
   → so http://localhost:8787/cards/abc123 → shortens → loads.
3. OG meta tags in index.html <head> → JS on `?share=` → after hydrated on page `og:title`, `og:description` with JS `document.title = ${fightCount fights savedcard UFC MarX`
4. Rewrite `README.md` completely:
   - Front page dual mode A vs B
   - Quick start
   - npm install:all
   - npm run dev 8080+8787
   - Supabase setup steps (.env, migrate_up)
   - Save Card flow
   - Share flow
   - Architecture diagram simple

### ⚪ WS-C. Single Command Start
See root package.json concurrently + npm run dev ✅ above. Add `CORS_ORIGINS` env tighten (after).

### ⚪ WS-D. Bet-Tracking UI (close the ROI loop)
| What to add:
- **Each Saved Card row → new buttons**: "💸 Add Bet" (select strategy → pick line + stake + outcome);
- **Bets List per Card** button → modal → table list bets per card → set outcome WIN/LOSS/PUSH → settled;
- **Backend routes** add `GET /api/bets` list + `POST /api/bets` + `POST /api/bets/:id/settle` PATCH;
- **Dashboard ROI table in Saved modal** → stats: `Total staked` + `Net P/L` + `Win %` + `ROI %`;
- **New DB migration 0002.sql** (backfill optional - bets table already has columns

### ⚪ WS-E. Live Odds Tier 2
schedule.js GET /upcoming from ODDS_API_KEY if env → provider from .env OddsJam/The-Odds-API endpoints:
```js
GET https://api.the-odds-api.com/v4/sports/mmamixedmartialarts/events?regions=us&markets=h2h&apiKey=
```
→ transform to internal event.id + fighter A/B + books arrays. cache 3 min in memory + stale-while-revalidate header `X-Cache: HIT` or MISS

### ⚪ WS-F. Deploy
**Option 1 Vercel: backend/vercel.json rewrites `/api/* → `backend/src/index.js → Serverless ✅ plus upload static frontend separate or put static on IGA Pages.
**Option 2 IGA Pages static → index.html + backend vercel serverless or same deploy backend to vercel → CORS_ORIGINS=iga-domain.
**Production domain set CORS_ORIGINS comma-separate exact origins not `*` + `?share=` + share cards:

### ⚪ WS-G. Test harness
Create backend/tests or use scripts smoke to Jest.
→ Jest basic for FN parity, calc parity REST; GitHub Actions yml push → run smoke after each push

## 5. Dependencies / Drift Risks to Mitigate
| Risk | Mitigation |
|------|------------|
| fightnomics.js drift 2 copies | Root postinstall cp to backend OR assert byte-identical via pre-commit (or skip for MVP + just docs note to remember copy on edit |
| Supabase JWT verify placeholder secret | We have SUPABASE_JWT_SECRET placeholder - not used if service role key bypass so anon_  OK for now if no real needed service bypass RLS via, but TODO |
| nanoid v4 would break CJS | pinned "nanoid": "^3.3.7" keep v3 stay <4 ✅ |
| PowerShell script syntax in check:all | Rewrite to `;` separated node --check sequence |
| Vercel vercel.json Serverless ESM/CJS | src/index.js CJS require ok ✅ Node 18+ 18.17 ✅ |
| CORS * → exploit leak | PROD fix exact origins |

## 6. Risk Matrix / Execution Order Suggested
```
EXECUTE ORDER → 
P0: WS-A (repo hygiene, root package.json, README rewrite, fix check:all) → Build P0 doc (share /cards/:token redirect share toast (http://localhost:8787/cards/XXX)
 →   → then P1: WS-D bet tracking UI + bets settle
 →   → then P1: WS-E live odds env or deploy WF
 → P2: WS-G tests + CI
```

## 7. Go/No-Go checklist before starting WS-A
All Go: Just Do It — all files, no external input needed (except Supabase is already connected. WS-A is mechanical edits only.
No-Go: NONE - approve to execute WS-A→B→C=deploy ✅

## 8. Deliverables Per Workstream Summary
| WS | deliver |
|----|--------|
| A | 4 files: root package.json, .gitignore both, backend/.gitignore, backend/package.json script fix |
| B | index.html /cards/:t redirect, meta OG, README rewrite |
| C | (delivered in A root package `concurrently - verified one `dev`` |
| D | saveBet UI + settle bets routes 0002 migration empty (no columns already have |
| E | schedule.js real odds fetch cache |
| F | vercel + IGA |
| G | jest tests + actions |

## 9. Files To Create or Modify Exact List
New files (create):
- `package.json` (root)
- `.gitignore` (root)
- `backend/.gitignore` (new if not existing: add node_modules, .env

Modify:
- `backend/package.json` check:all → powershell sequence semicolons
- `backend/src/index.js` cards/:token short URL
- `index.html` head meta tags (OG) <title> dynamic? No title is static → /cards/:token rewire → OK
- `README.md` — COMPLETE rewrite (dual-mode, install, run, supabase, odds, save, share, bet, deploy)
- `js/app.js` — add bets UI hooks to existing open dashboard; + bets via `attachBackendIntegration()` → listBetsCard() + saveBet() + settleBet() functions
- `backend/src/routes/bets.js` (create) → 5 routes: GET /, POST /, GET /:id, PATCH /:id/settle, DELETE /:id
- `backend/src/index.js` mount `/api/bets` app.use
- `backend/supabase/migrations/0002_migration if anything added if needed not

## 10. Execute after approval
| Step order execution
1. WS-A files create + edit
2. WS-B redirect + OG + README
3. WS-C npm run dev → test start
4. WS-D bets tracking full stack
5. WS-E live odds feed
6. WS-F deploy
7. WS-G tests
