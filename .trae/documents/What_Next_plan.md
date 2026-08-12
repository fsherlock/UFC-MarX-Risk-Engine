# WHAT NEXT — UFC MarX Roadmap (Post-Saved-Dashboard-Fix Edition)

_Date: 2026-08-10 · Prior-work baseline: Live odds pipeline ✅ 60/60 smoke ✅ saved dashboard payload fix (THIS session) ✅ /config chip ✅_

## 1. Current-State Audit (Repo Research Conclusion)

### What's live & green right now

```
┌─ Browser (index.html + js/app.js ~ 4300 lines) ─────────────────────────────────┐
│  • Build fights (1..5) · 3-mode prob (user/fn/market) · 4 strategies            │
│  • Kelly frac · Odds toggle US/DEC · MC simulation median · PDF export           │
│  • Odds dashboard chip 📡 (provider, books, cache ttl)                           │
│  • Upcoming schedule tiles with background headliner LIVE odds inject            │
│  • Tile actions: Populate / ⚡ LIVE (one-click populate+market+inject+Kelly)     │
│  • Pin/Épinglé & Hide on upcoming tiles · sort by recent/roi/win%/bets           │
│  • Share preview widget + Tweet / Copy Parlay / Copy Link                        │
│  • /?share=TOKEN auto-load on DOMContentLoaded via API                           │
│  • Saved dashboard modal: 4-col stats grid · sparkline · load/addBet/bets/share  │
└──────────────────────────────────────────────────────────────────────────────────┘
┌─ Node/Express backend (port 8787) ─────────────────────────────────────────────┐
│  POST /api/calculate · /fight-probabilities · GET  /calculate/health            │
│  GET  /api/auth/me | POST /auth/login /logout (stub)                            │
│  GET  /api/cards | POST /api/cards | GET  /api/cards/share/:token   [NO delete] │
│  GET  /api/bets[?card_id=X] | POST /api/bets | GET /api/bets/:id                │
│  PATCH /api/bets/:id/settle | DELETE /api/bets/:id                               │
│  GET  /api/schedule/upcoming | /odds/:eventId | /config (NEW last session)      │
│  • db.js dual-mode: SUPABASE (prefer if env set) ↔ MEMORY (DEMO)                 │
│  • odds-api.io v3 proxy: ODDS_API_KEY server-only · 180s cache · 2 books        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 13 Concrete Gaps Found (priority sorted CRITICAL first)

#### 🔴 TIER 1 / CRITICAL BLOCKERS (must fix before launch/share)

| #      | Gap                                                                   | Why it hurts                                                                                                                                                                                                                                                                                                                                                                                                        | Current code evidence                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1     | **No DELETE / PATCH /api/cards/:id** + no 🗑️/✏️ per saved card       | Saved list grows unbounded; user can't erase test cards. [cards.js L20-L49](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/cards.js#L20-L49) has only GET/POST/share                                                                                                                                                                                                                | [db.js L166 exports](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/db.js#L166-L172) exposes no `deleteCard/updateCard`                                                         |
| C2     | **/cards/:share 302 redirect handler missing in backend**             | The index L202+ promised `/cards/:token → 302 /?share=TOKEN` but we only serve static HTML from root. Visiting share link directly returns 404.                                                                                                                                                                                                                                                                     | Backend [index.js L75-L79](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/index.js#L75-L79) mounts no `/cards/*` route.                                                         |
| C3     | **hydrateFromSavedPayload skips** **`mcEnabled`**                     | Load a saved card that had Monte-Carlo ON → checkbox silently resets OFF, changing strategy results & recalc gives different numbers.                                                                                                                                                                                                                                                                               | [app.js hydrate L4176-L4219](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L4176-L4219) — writes bankroll/probMode/fights/confidences/statuses, no mcToggle.checked write        |
| C4     | **Share preview never writes saved permalink back into shareLinkBox** | Save → toast shows link, but the OG share widget (`#shareLinkText`, Tweet, Copy-Parlay) stays in its empty "Build & save your card…" initial state forever on load. [enableShareButtons](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L3403-L3433) is only called inside `saveCard` success. It's NOT called after `/cards/share/:token` autoload OR after Load button inside saved modal. | <br />                                                                                                                                                                                                   |
| <br /> | C5                                                                    | **Hydrate doesn't fire** **`change`** **on mcToggle or probMode radio** → engine revalidate triggers partially                                                                                                                                                                                                                                                                                                      | Prob mode radio writes `r.checked=true` but never dispatches change. mcToggle same. vF validation re-run but the strategy build might not have latest state if any listeners depend on change/mcChanged. |

#### 🟡 TIER 2 / UX / MEANINGFUL UPGRADES (big bang for buck, no backend risk)

| #  | Gap                                                                                                                                                                                                                       | Why it matters |
| -- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| U1 | Saved dashboard hint says "Click a card to quick-preview bets" but **no click-then-quick-preview handler exists** (only 4 buttons). Empty feature claim = bad UX.                                                         | <br />         |
| U2 | **Inline expand/collapse per saved card**: right now only 3-fight summary + "N fights · br $X". User needs 1-click to see EVERY fight (odds, confidences, status NEUTRAL/WIN/LOSS/PUSH) without loading the whole engine. | <br />         |
| U3 | **Badge "🔄 MIGRATED / STALE" column on saved cards** (compare payload shape version — today if we add a new field old cards silently ignore it).                                                                         | <br />         |
| U4 | Saved dashboard has 4 sort pills but **no SEARCH / filter box** by fighter name / note substring. Annoying at 20+ cards.                                                                                                  | <br />         |
| U5 | Sparkline only plots cumulative P/L along settled bets. No **per-card ROI bars** (visualize which cards dragged portfolio down).                                                                                          | <br />         |
| U6 | `⚡ LIVE` populated odds into inputs, but if user then hits **💾 Save** there's no badge that this card was "market-live-sourced at HH:MM UTC". A year later you can't distinguish manual lines vs API lines.              | <br />         |

#### 🟢 TIER 3 / POLISH / DATA-QUALITY (nice to have)

| #  | Gap                                                                                                                                                                                                                                             |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1 | `listCards` no pagination; if user has 500 cards payload becomes huge. Add `?limit=20&skip=0`.                                                                                                                                                  |
| P2 | Backend has NO `deleteCardSupabase` / `deleteCardMemory` / `updateCardSupabase` / `updateCardMemory` implementations despite exports gap. Add these + module tests.                                                                             |
| P3 | `/cards/:id` individual get (currently ONLY share token route, not id). Needed for future per-card edit UX.                                                                                                                                     |
| P4 | No Supabase migration SQL files. Tables "cards" + "bets" are assumed to exist. Ship `backend/supabase/001_init.sql` + instructions to enable RLS.                                                                                               |
| P5 | Auth: [auth.js /me](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/auth.js#L17-L30) returns `authenticated: db.isSupabase` — WRONG, true only if SUPABASE env set, not if user actually logged in with JWT sub. |

***

## 2. Proposed Execution Path (4 Phases, \~20 code edits)

All phases below are independent and ordered by user-visible impact.

### PHASE A — CRITICAL TIER 1 FIXES (Backend + Frontend parity)

**Goal: All "it breaks silently / data loss / 404 share link" scenarios ELIMINATED.**

#### Step A1 — Add card CRUD endpoints + DB layer primitives

* Edit [backend/src/db.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/db.js) → add:

  * `deleteCardSupabase(id, userId)` → `.delete().eq("id",id).eq("user_id",uid)`

  * `deleteCardMemory(id, userId)` → `.delete` from Map

  * `updateCardSupabase(id, userId, patch)` → `.update({ payload, note, updated_at }).select().single()`

  * `updateCardMemory(id, userId, patch)` → mutate payload\_json/note/updated\_at in Map

  * `getCardByIdSupabase(id, userId) / getCardByIdMemory(...)` → single fetch

  * export all 6

* Edit [backend/src/routes/cards.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/cards.js) → add BEFORE module.exports:

  * `GET /:id` → return one card (auth gating by user\_id)

  * `PATCH /:id` → partial update { note?, payload? } → forbid user\_id tamper

  * `DELETE /:id` → return { deleted: true }

  * All 3 routes run through `currentUserId(req)` like existing GET/POST.

#### Step A2 — Wire 🗑️ & ✏️ buttons onto every saved card

* Edit [js/app.js refreshSavedDashboard card template](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L4093-L4148) → insert 2 more inline-flex buttons before 💸 Add Bet:

  * `saved-rename` (✏️ Rename) — prompt for new note → PATCH /api/cards/:id → refreshSavedDashboard

  * `saved-delete` (🗑️) — confirm → DELETE /api/cards/:id → refreshSavedDashboard, count badge decr

* Both read `data-id="${c.id}"` dataset attr.

#### Step A3 — Backend redirect route `/cards/:token` 302

* Edit [backend/src/index.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/index.js#L73-L80) → ADD BEFORE route mounts or static fallback:

  ```
  app.get("/cards/:token", (req, res) => {
    const safe = encodeURIComponent(req.params.token);
    res.redirect(302, `/?share=${safe}`);
  });
  ```

  (Important: mount this BEFORE static middleware so it wins.)

#### Step A4 — hydrateFromSavedPayload parity fill

* Edit [app.js L4176-L4219](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L4176-L4219):

  * after probMode `r.checked = true` → **dispatchEvent** **`change`** **bubbles=true**.

  * new block: if `typeof p.mcEnabled === "boolean"` → find `#mcToggle`, set `.checked = p.mcEnabled`, then dispatch change event so any MC listeners re-run.

  * new block: capture the oddsFormatAmerican write to a hidden toggler so US odds display is preserved (currently write odds but if user saved in AMERICAN it loads DECIMAL because odds input doesn't re-trigger oddsFormatAmerican to flip).

#### Step A5 — Wire `enableShareButtons(permalink, payload)` after Load + autoload

* In [loadCardByToken](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L4164-L4174) after `.then(data…)` → compute permalink = `BASE + /cards/${encodeURIComponent(token)}` → call `window.__creative?.enableShareButtons?.(permalink, payload)`.

* Same inside [tryAutoLoadFromShareParam](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L4222-L4232) success branch.

**Expected tests after Phase A**:

* `curl -X DELETE localhost:8787/api/cards/<id>` returns 200 { deleted: true } and count badge drops 1 next refresh.

* Visiting `http://localhost:8787/cards/<token>` in browser redirects once to `/?share=<token>` + auto-hydrates fights + auto-populates share widget permalink box.

* Save card with mcEnabled=true, AmericanOdds=true, probMode=fn → close tab, re-open via share link → all 3 controls match.

***

### PHASE B — SAVED DASHBOARD UX POWER-UPS

**Goal: Saved stops being a list; becomes a real PORTFOLIO workspace.**

#### Step B1 — Click-card quick-preview (fulfil existing hint text)

* Click on the `.group` wrapper (NOT on a button) bubbles up to delegated listener.

* If `e.target.closest("button,a")` → bail (let button handlers run). Else: expand/collapse in-place (see B2).

#### Step B2 — Per card expandable fight roster (toggle)

* Insert after the 3-fight summary `<div class="saved-fights-detail hidden">` containing a per-fight mini-row: name A vs name B, odds A / odds B, conf A% · conf B%, status pill (NEUTRAL / WIN / LOSS). Uses `payload.fights[]`.

* Click header toggles `.hidden` class + rotates arrow.

#### Step B3 — Search / filter saved

* Insert `input#savedSearch` before sort pills in [index.html saved modal markup L484-L495](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/index.html#L484-L495).

* In [refreshSavedDashboard L3937-L4152](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L3937-L4152), before `.map()` → filter `enriched` by `searchTerm` against note + all fighter names concatenated, case-insensitive includes.

* Live listener on search input debounced 200ms → rerender list (no backend refetch, use already-loaded `cards` in closure-scoped cache).

#### Step B4 — "⚡ LIVE-sourced" tag when odds came from API

* On `⚡ LIVE` handler success toast, save `payload.source = { type:"live-odds", at: new Date().toISOString(), provider: window.__oddsConfig?.provider || "odds-api.io" }`.

* Save Card carries this over. Card tile in Saved dashboard shows a tiny badge `📡 LIVE at 22:04 UTC` if `payload.source?.type === "live-odds"`.

***

### PHASE C — PORTFOLIO ANALYTICS DEEP DIVE

**Goal: Sparkline + ROI bars so user can spot which saved card was a leak.**

#### Step C1 — Per-card ROI mini-bar chart above cards list

* New `<canvas id="savedRoiBars" width="800" height="72">` next to existing sparkline container in HTML.

* Render: X = cards in current sort order, Y = ROI%, 0 baseline, bars emerald above / rose below. Hover via title attributes or tooltip.

#### Step C2 — Sparkline per-card mode toggle

* Add tiny toggle `Cumulative P&L | Per-card ROI` pills above sparkline. Switches canvas dataset.

#### Step C3 — Data quality badges

* On every card render, compare `Object.keys(f)` schema to latest `serializeCurrentCard()` keys. Show 🟢 schema current, or 🟡 STALE `(missing: mcEnabled, source)` if a card from older payload shape is loaded. Load still works; badge is informational only.

***

### PHASE D — INFRASTRUCTURE / LAUNCH READINESS

#### Step D1 — Supabase schema SQL file + auth fix

* Create `backend/supabase/001_init.sql` with:

  ```sql
  create table cards (id text primary key, user_id text not null, share_token text unique not null, note text, payload jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
  create table bets  (id text primary key, user_id text not null, card_id text references cards(id) on delete cascade, payload jsonb, outcome text, settled_at timestamptz, created_at timestamptz default now());
  alter table cards enable row level security;
  alter table bets enable row level security;
  -- policies omitted (ANON vs USER role — include RLS templates per docs)
  create index on cards(user_id, created_at desc);
  create index on bets(card_id, created_at desc);
  ```

* Fix auth/me `authenticated` to reflect REAL JWT session: `authenticated: req.headers.authorization?.startsWith("Bearer ") && (currentUserId(req) !== "anon")`.

#### Step D2 — Smoke tests for new routes

* Extend `scripts/smoke_calculate.js` with a 2nd block: `PHASE 5 CARDS CRUD`:

  1. POST /api/cards → get token
  2. GET  /api/cards/:id → 404 for wrong id / 200 for real
  3. PATCH rename note → verify
  4. DELETE → verify list shrinks
  5. GET  /cards/:token 302 redirect (via node `http` request + 3 max redirects follow, final URL contains `?share=`).

***

## 3. File-edit Priority Matrix (what files change per phase)

| File                                  |                             A (critical)                            |                                B (UX)                                |                     C (analytics)                    |         D (infra)        |
| ------------------------------------- | :-----------------------------------------------------------------: | :------------------------------------------------------------------: | :--------------------------------------------------: | :----------------------: |
| `backend/src/db.js`                   |                         ✅ exports 6 new fns                         |                                <br />                                |                        <br />                        |          <br />          |
| `backend/src/routes/cards.js`         |                       ✅ GET/PATCH/DELETE /:id                       |                                <br />                                |                        <br />                        |          <br />          |
| `backend/src/index.js`                |                    ✅ `/cards/:token` 302 redirect                   |                                <br />                                |                        <br />                        |          <br />          |
| `backend/src/routes/auth.js`          |                                <br />                               |                                <br />                                |                        <br />                        | ✅ /me authenticated flag |
| `js/app.js`                           | ✅ rename/delete buttons + hydrate parity + enableShareButtons calls |          ✅ click preview, expand, search, LIVE tag + filter          | ✅ per-card ROI bars + sparkline toggle + STALE badge |          <br />          |
| `index.html`                          |                                <br />                               | ✅ #savedSearch, expand arrow html placeholders, #savedRoiBars canvas |                        <br />                        |          <br />          |
| `backend/supabase/001_init.sql` (NEW) |                                <br />                               |                                <br />                                |                        <br />                        |             ✅            |
| `backend/scripts/smoke_calculate.js`  |                                <br />                               |                                <br />                                |                        <br />                        |      ✅ PHASE 5 block     |

***

## 4. Considerations / Dependencies

* **No new npm modules.** All changes vanilla Node + Express + Supabase JS client that's already installed.

* **Rate limits respected:** Phase B's search is client-side only — no extra `/api/cards` requests per keystroke.

* **Share permalink safety:** 302 redirects in Step A3 encodeURIComponent the token so no open-redirect via path traversal chars.

* **Supabase backward compat:** existing cards/bets rows have `payload` column already (JSONB) so D1 schema SQL is additive. MEMORY mode unaffected; same 4 new fns have memory branches.

***

## 5. Risk Handling

| Risk                                                                                    | Severity | Mitigation                                                                                                                   |
| --------------------------------------------------------------------------------------- | :------: | ---------------------------------------------------------------------------------------------------------------------------- |
| DELETE cascades to bets accidentally in SUPABASE mode                                   |   HIGH   | L40 SQL uses `on delete cascade` on bets.card\_id → correct. Test in smoke Phase D2 first. Do NOT ship DELETE without smoke. |
| Hydrate write "mcEnabled true" breaks user's session current workflow toggle state      |    MED   | Only hydrate if the loaded card explicitly has the field. Use `typeof p.mcEnabled === "boolean"` guard.                      |
| 302 `/cards/:token` conflicts with existing static `cards.html` file (if created later) |    LOW   | Mount route BEFORE static middleware; any future `cards.html` rename to something else.                                      |
| Search filtering on large lists drops frames >500 cards                                 |    LOW   | Debounce 200ms + limit render to 50 rows with "Show N more" button if needed.                                                |
| Renaming card changes `note` but search filter uses old note                            |    LOW   | Patch response returns updated row; refreshSavedDashboard fetches fresh list, so stale data impossible.                      |

***

## 6. Execution Order Checklist (24 items)

### Phase A (Critical) — MUST DO FIRST 🔴

* [ ] A1.1 `deleteCardSupabase + updateCardSupabase + getCardByIdSupabase` in db.js

* [ ] A1.2 `deleteCardMemory + updateCardMemory + getCardByIdMemory` in db.js + exports

* [ ] A1.3 `GET /api/cards/:id` route in cards.js

* [ ] A1.4 `PATCH /api/cards/:id` (rename + payload patch)

* [ ] A1.5 `DELETE /api/cards/:id` (cascade verified)

* [ ] A2.1 🗑️ Delete button HTML + handler, wire dataset id

* [ ] A2.2 ✏️ Rename button (prompt → PATCH → refresh)

* [ ] A3.1 `/cards/:token` 302 redirect route **BEFORE static** in index.js

* [ ] A4.1 hydrate: probMode radio dispatch `change`

* [ ] A4.2 hydrate: `#mcToggle.checked = p.mcEnabled` + dispatch

* [ ] A4.3 hydrate: oddsFormatAmerican toggle reapply if p.oddsFormatAmerican true

* [ ] A5.1 Call enableShareButtons inside loadCardByToken success

* [ ] A5.2 Call enableShareButtons inside tryAutoLoadFromShareParam success

### Phase B (UX power-ups) 🟡

* [ ] B1   Click card wrapper → expand detail (ignore if target is button/link)

* [ ] B2   Expandable fight roster per card + toggle arrow

* [ ] B3.1 Add #savedSearch HTML input

* [ ] B3.2 Filter + debounce client-side

* [ ] B4   `payload.source` on ⚡ LIVE + badge in saved

### Phase C (Analytics) 🟢

* [ ] C1   Per-card ROI bars canvas

* [ ] C2   Sparkline mode toggle

* [ ] C3   STALE / CURRENT schema badge

### Phase D (Launch / Infra)

* [ ] D1.1 Create supabase/001\_init.sql

* [ ] D1.2 Fix /api/auth/me authenticated to real JWT check

* [ ] D2   Phase 5 CRUD + redirect smoke tests added

***

## 7. Recommended NEXT STEP Selection for User

Given your prior tickets focused on **making Saved + odds + ROI work correctly first**, my recommendation is to start with **PHASE A ONLY for the next implementation pass** (the 13 most-concrete items above). PHASE A alone fixes: deleting clutter cards, share links that actually work when you paste them into Discord/Twitter/X, and hydrate parity so loading a saved card doesn't silently change MC/prob mode/odds format.

If you want maximum user-visible fun instead, **PHASE B (saved search + expandable fight list + LIVE-source badge)** is the single pass that makes the dashboard "feel" complete.

Proceed with which phase first? → Recommendation: **PHASE A FIRST, then immediately PHASE B.**
