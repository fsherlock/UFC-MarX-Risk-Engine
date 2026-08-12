# UFC MarX Risk Engine

> **Dual-mode MMA parlay builder.**
> **Mode A — Zero-install static**: just double-click `index.html` (no npm, no backend, no API keys required). All math runs in your browser.
> **Mode B — Persistent backend** (this repo default): run `npm run dev` → Kelly + Fightnomics math **identical to browser** plus Supabase save / share permalink / bet ROI tracking / live UFC odds proxy.

Math parity invariant: every Fightnomics prior, Kelly stake, Monte Carlo P5/P95, and vig-removal result in the backend is **byte-for-byte identical** to the browser, because the same `fightnomics.js` source file ships to both.

---

## 🚀 Quick Start (3 commands)

```powershell
# 1. Install root + backend
npm run install:all

# 2. Verify drift between browser + backend copies
npm run verify:drift      # should print: OK / OK

# 3. Start STATIC (port 8080) + BACKEND (port 8787) in one shell:
npm run dev
```

Then open http://localhost:8080  (or the backend-served single-server at http://localhost:8787).

### Static-only (no npm, no backend, no Supabase)

Double-click `index.html`. Works offline. Save/share/bet-tracking UI is disabled — only local math.

---

## 🧠 What It Calculates

| Feature | How |
|---------|-----|
| **25-feature Fightnomics prior** | Reach, stance, age/rust, debut jitters + 8 FightMetric z-weighted sum · **AUC baseline 0.76** |
| **Broadview no-vig market prob** | `1/oA / (1/oA + 1/oB)` + vig % per fight, with fallback when odds missing |
| **Probability Drive 3-way toggle** | `My Confidence` / `FN Prior` / `Market (No Vig)` — each drives Kelly engine independently while the other two are shown as reference. Fallback chain: if the driver can't compute it falls through → you always get valid `pA+pB=1.00` after a final sum-normalize clamp |
| **0.25× Fractional Kelly** | `f = (bp−q)/b × 0.25` with **overflow rescale**: if sum of stakes > BR, linearly rescale every row down so sum = BR |
| **Parlay engine with safety caps** | Up to 5 fights = 31 non-trivial parlays (cap by Kelly score, truncate to `truncateParlaysLimit` default 1000) |
| **Monte Carlo 10 000-trial** | Deterministic mulberry32 seeded PRNG · fight-by-fight Bernoulli · shared-leg autocorrelation for **honest P5/P95/drawdown** that leads closed-form |
| **Tale of the Tape 4-column** | Reach + Stance + Age + Record · cross-fight per fighter · cites Fightnomics/Kaggle/UFC-Stats/Tapology/Sherdog |
| **Save · Share · Bet tracking** | Supabase Postgres (eu-west-1). 12-char nanoid share token → `/cards/:token` permalink autoloads the card into the builder |

---

## 🏗️ Architecture

```
ufc/
├── index.html               ← markup, Tailwind CDN, Config header, Save/Saved buttons, Saved modal, toasts
├── css/style.css            ← animations, autocomplete, scrollbars, drive-chip highlight styles
├── js/
│   ├── app.js               ← validation, Kelly math, parlays, Monte Carlo, autocomplete, TaleTape, saveCard / loadShare / bets UI
│   ├── fightnomics.js       ← 25-feature prior module (SOURCE OF TRUTH — copied to backend/services/)
│   └── data.js              ← legacy local fighter map (used by autocomplete fallback)
├── data/
│   └── fighter_stats_bundle.js  ← 308-fighter schema v1.0-seed (SOURCE OF TRUTH — copied to backend/services/)
├── scripts/
│   └── regen_bundle.js      ← re-build fighter_stats_bundle.js from raw CSVs
├── backend/                 ← Tier 1 + Tier 1.5 Express API (Vercel Functions-compatible)
│   ├── package.json         ← `npm run dev / start / smoke / check:all / migrate:up`
│   ├── .env                 ← your SUPABASE_URL / SERVICE_ROLE_KEY / ODDS_API_KEY (gitignored)
│   ├── .env.example         ← copy → `.env` and paste values
│   ├── vercel.json          ← rewrites /api/* → src/index.js for Vercel Serverless
│   ├── supabase/
│   │   └── migrations/
│   │       └── 0001_cards_and_bets.sql  ← tables + RLS + policies + updated_at trigger (APPLIED LIVE to jlizbewyzydsaqdyopnq)
│   ├── scripts/
│   │   ├── smoke_calculate.js    ← 60 math assertions (Fightnomics parity, Kelly 0.05 reference, 3-mode prob resolver, 3×4 strategy outputs)
│   │   └── migrate_up.js
│   └── src/
│       ├── index.js          ← Express entry · CORS strict · /cards/:token → /?share= redirect · static serving
│       ├── db.js             ← Dual storage: Supabase Postgres (if env) OR In-Memory demo (DEMO ONLY wipe on restart)
│       ├── routes/
│       │   ├── calculate.js  ← GET /health, POST / (full strategies), POST /fight-probabilities (3-mode resolver)
│       │   ├── cards.js      ← GET /, POST / (save → 201 + shareToken), GET /share/:token (public, bypasses self-RLS)
│       │   ├── bets.js       ← GET /, POST /, GET /:id, PATCH /:id/settle, DELETE /:id
│       │   ├── auth.js       ← POST /login (stub), GET /me (storage + features flag)
│       │   └── schedule.js   ← GET /upcoming, GET /odds/:eventId (the-odds-api live OR STUB demo)
│       └── services/
│           ├── fightnomics.js          ← **VERBATIM copy** of js/fightnomics.js (math parity)
│           ├── fighter_stats_bundle.js ← **VERBATIM copy** of data/fighter_stats_bundle.js
│           └── strategies.js           ← Pure math (no DOM) — same algo as browser app.js
└── .trae/documents/          ← Master plan + feasibility plans (created during build)
```

### Dual-Mode Product Choice

You can deploy **either or both**:

| Mode | Host | How to access | Persistent? |
|------|------|---------------|-------------|
| **Static zero-backend** | IGA Pages / Cloudflare Pages / GitHub Pages | `https://your-static-domain` | ❌ — save/share buttons disabled |
| **Backend + static same server** | Vercel serverless (backend) + same repo static | `https://your-domain` via vercel.json rewrites, or localhost:8787 | ✅ Supabase cards/bets |
| **Static + Backend separate** | IGA Pages static + Vercel backend (CORS strict) | `https://static.foo` → talks to `https://api.foo` via `window.BACKEND_BASE_URL` | ✅ |

---

## 🔗 Save · Share · Bet-Tracking Flow

```
Build card (odds + confidence)
  ↓  click 💾 Save Card
POST /api/cards                → DB insert · nanoid share_token generated
  ↓  toast appears:
🔗 Share: http://localhost:8787/cards/AbCd1234xYz5
  ↓  someone clicks link
GET /cards/:token              → 302 → /?share=AbCd1234xYz5
                                 → frontend auto GET /api/cards/share/:token
                                 → hydrates fight count, odds, confidence, probMode
  ↓  card shows exactly as builder left it

Saved Dashboard → per card row:
  💸 Add Bet → pick a strategy row, enter stake, save
  📊 Bets → mark WIN / LOSS / PUSH → settled_at set
  📈 Dashboard ROI strip: Total Staked · Net P/L · Win % · ROI %
```

---

## 🗄️ Supabase (Live — eu-west-1 · `jlizbewyzydsaqdyopnq`)

Migration **0001_cards_and_bets.sql** is applied live. RLS is enabled with self-only policies plus a public share-token read exception.

`backend/.env` (already written — never commit this file, it's in `.gitignore`):
```
PORT=8787
SUPABASE_URL=https://jlizbewyzydsaqdyopnq.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from Project Settings → API · never paste into frontend>
SUPABASE_JWT_SECRET=<rotate JWT, or leave placeholder — auth/me still works>
ODDS_API_PROVIDER=STUB_DEMO            # or the-odds-api / oddsjam
# ODDS_API_KEY=<paste here for live odds>
CORS_ORIGINS=*,http://localhost:8080,http://localhost:8081,http://localhost:8787
```

### CORS tightening for Production

Replace the first `*` with exact origins only. e.g.:
```
CORS_ORIGINS=https://marx.foo,https://ufcmarx.pages.dev,http://localhost:8080,http://localhost:8787
```

---

## 🧪 Quality Gates (smoke tests before every deploy)

```powershell
# Syntax check all backend JS files + browser JS files
npm run lint

# 60 math assertions — fightnomics parity, Kelly 0.05 reference, 3-mode resolver, 3×4 strategies
cd backend ; npm run smoke   # exits 0 on pass, 1 on any fail

# Browser vs backend copy drift
npm run verify:drift         # exits 0 if identical, 1 if drift → run `npm run sync:bundle`
```

### Math Parity Reference (Fightnomics Ch.11 + internal vector)
```
kellyFraction(odds=2.0, prob=0.60) = 0.0500 exactly (½ Kelly = 0.10; × 0.25 Fractional = 0.05)
fightnomicsPrior(Adesanya vs DuPlessis 2.10 / 1.79) = 0.7109  (browser === backend)
```

---

## 🎲 Live Odds Feed (Tier 2) — the-odds-api.com

`GET /api/schedule/upcoming` returns upcoming UFC events. `GET /api/schedule/odds/:eventId` returns h2h arrays per book.

To enable **live** instead of stub:
1. Buy key at https://the-odds-api.com
2. Paste into `backend/.env`:
   ```
   ODDS_API_KEY=abc123yourkey
   ODDS_API_PROVIDER=the-odds-api
   ```
3. Restart backend. Cache TTL = 3 minutes in memory (`X-Cache: HIT/MISS` response header).

---

## 🚢 Deploy

### Option 1 — Vercel (Serverless backend + static)
```bash
# in repo root (ufc/):
vercel deploy
```
`backend/vercel.json` rewrites `/api/:path* → backend/src/index.js` for Vercel Functions. Uploads `src/`, `data/`, `supabase/migrations/`.

### Option 2 — IGA Pages (static only) + Vercel backend
1. Set `window.BACKEND_BASE_URL = "https://your-vercel-project.vercel.app"` in `index.html` before app.js
2. Deploy to IGA Pages
3. Add the IGA domain to `CORS_ORIGINS` in `backend/.env` → re-deploy Vercel

### Option 3 — single server Node
```bash
cd backend ; npm run start      # serves static + API from http://your-VPS:8787
```
(Reverse-proxy with nginx + TLS via Caddy if you want.)

---

## ⚠️ Known Risks + Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `js/fightnomics.js` 2 copies drift | Math parity broken → browser ≠ server | `npm run verify:drift` pre-deploy gate + `sync:bundle` helper |
| nanoid v4 upgrade breaks CJS require | backend crashes | pinned `"nanoid": "^3.3.7"` — never upgrade to v4 |
| Supabase service role pasted into frontend | DB breach possible via anon console | `backend/.env` is gitignored + JWT secret is separate from anon key; anon key allowed in browser only |
| STUB demo odds used in Prod | Kelly stakes wrong size | API discovery page (`GET /api`) shows warning banner |
| 5-fight parlay cap violation | 2^N explodes | Hard cap at fights.length ≤ 5 → `generateParlays()` returns at most 31 non-trivial combos |

---

## 🛣️ Roadmap Tier 2/Tier 3 (built next on request)

- **Tier 2 — ML retrain + Kaggle pipeline** · refit Fightnomics z-weights per-year, auto import Kaggle `ufcdata` CSVs via `scripts/regen_bundle.js` cron
- **Tier 3 — Notifications + Mobile** · settled bet webhook to Telegram / Discord, PWA installable with SW cache

---

## 📜 License + Data Sources

Fightnomics citation embedded in `js/fightnomics.js:679` → cites: Reed Kuhn & Kerry Micks · Fightnomics (2014); Kaggle `martinellis/ufc`; UFC-Stats public pages; Tapology; Sherdog.
