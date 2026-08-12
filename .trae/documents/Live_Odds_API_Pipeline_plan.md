# Live Odds API Pipeline — Plan Document

## 1. Repo Research Conclusion

### 1.1 Current Architecture (Already Working)
The UFC MarX Risk Engine **already has a fully functional live odds pipeline** using the `odds-api.io v3` API. The system is configured in:

- **API Key**: Stored in [backend/.env](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/.env#L16-L19) as `ODDS_API_KEY=010b05c1ba84eb53382effe14734e184b0d4895200fa6bd817500daa5032c586`
- **Provider**: `odds-api.io` (NOT `the-odds-api.com` — different schema, confirmed by project memory)
- **Sport Slug**: `mixed-martial-arts` (NOT `mma`)
- **Free Tier Limits**: 100 req/hr · 500/day · max 2 bookmakers (currently `1xbet, Stake`)
- **Cache Strategy**: 3-minute in-memory TTL cache (`Map`-based) in [schedule.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/schedule.js#L20-L30)

### 1.2 End-to-End Pipeline Flow (Current)

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│  BROWSER UI     │────▶│  NODE/EXPRESS   │────▶│  ODDS-API.IO v3      │────▶│  BOOKMAKERS      │
│  (js/app.js)    │◀────│  (schedule.js)  │◀────│  (API Key Auth)      │◀────│  1xbet / Stake   │
└─────────────────┘     └─────────────────┘     └──────────────────────┘     └──────────────────┘
       ▲                        ▲                         ▲
       │  2 endpoints           │  2 fetch functions      │  2 resource URLs
       │                        │                         │
       ├─ /api/schedule/upcoming├─ fetchLiveUpcoming()    ├─ /events?apiKey=X&sport=mixed-martial-arts
       └─ /api/schedule/odds/:id└─ fetchLiveOdds(eventId) └─ /odds?apiKey=X&eventId=Y&bookmakers=A,B
```

### 1.3 Backend Implementation Details

**Route 1 — `/api/schedule/upcoming`** [schedule.js L229-L259](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/schedule.js#L229-L259):
- Calls `fetchLiveUpcoming()` → `GET https://api.odds-api.io/v3/events`
- Groups raw fight events BY LEAGUE (UFC / Bellator / ONE / etc.) into event "cards"
- Each fight object carries `_eventId` (the per-bout odds API ID), `fighters: [home, away]` STRING array
- Cache key: `"upcoming"` → 3 min TTL
- Fallback chain: cache HIT → live fetch → STUB demo on failure

**Route 2 — `/api/schedule/odds/:eventId`** [schedule.js L261-L291](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/schedule.js#L261-L291):
- Calls `fetchLiveOdds(eventId)` → `GET https://api.odds-api.io/v3/odds`
- Query params: `eventId` + `bookmakers=1xbet,Stake` (2 max for free tier)
- Auto-recovery: If API returns `"Access denied … allowed max 2 bookmakers. Allowed: X, Y"` → regex extracts allowed books + retries
- Extracts Moneyline market (`ML` / `1N2` / `MONEYLINE`) from each bookmaker
- Returns: `{ provider, eventId, markets: [{ weight, fighters, books: [{book, decOdds, american}] }], _note? }`
- Cache key: `"odds:" + eventId` → 3 min TTL
- Fallback chain: cache HIT → DEMO_ODDS static map → live fetch → empty `markets:[]` on failure

### 1.4 Frontend Implementation Details

**Upcoming schedule fetch** [app.js L2814](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L2814):
```js
fetch(BASE + "/api/schedule/upcoming")  → stores in UPCOMING_CACHE[] → renders .upc-tile grid
```

**Per-event odds button click** [app.js L3018-L3111](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js#L3018-L3111):
- UFC cards: reverse fight list (headliners first) because prelims rarely have lines
- Walks fights in order → tries `GET /api/schedule/odds/{fight._eventId}` per bout
- Frontend 2nd-level cache: `window.__UPCOMING_ODDS_CACHE` Map, 180s TTL
- Inline fallback: `inlineLinesOf(fight)` extracts 4-source odds from tile payload BEFORE hitting API (solves the "always not posted" bug from last session)

### 1.5 Verified Status (from prior sessions)
- 43/43 HTTP endpoints pass ✅
- 60/60 calculation smoke tests pass ✅
- 20/20 odds feed smoke checks pass ✅
- API key confirmed live: UFC 330 Makhachev vs Machado correctly returns from odds-api.io ✅

---

## 2. Identified Gaps & Proposed Improvements

### Gap 2.1: Tile Rows Show "Odds Not Posted Yet" Even When Lines Exist
**Current state**: The `fetchLiveUpcoming()` response groups fight events by league but does NOT embed per-bout decimal odds in the tile fight rows. The tile only has `fighters: [string, string]` + `_eventId`. Users have to click "📊 Odds" button per tile to see if lines exist.

**Impact**: Every tile row defaults to "odds not posted yet" text, which is misleading — odds may be live but require an extra per-bout API call to discover.

**Proposed fix (Optional Enhancement)**: Add a **background odds hydration pass** that, after the upcoming tiles are rendered, makes parallel `fetchLiveOdds()` calls for the HEADLINER fight of each event (reverse-order index 0) and injects the odds directly into the DOM tile rows WITHOUT user clicking.

### Gap 2.2: Free-Tier Bookmaker Limit Not Visible to User
**Current state**: The 2-bookmaker limit is handled server-side but users don't know which 2 books are being queried. If the API key is upgraded, the `ODDS_API_BOOKMAKERS` env var needs a manual edit.

**Proposed fix**: Add a `/api/schedule/config` endpoint that returns `{ provider, bookmakersAllowed, tierFree: boolean, cacheAgeSec }` and surface it in the dashboard meta chip.

### Gap 2.3: No "Best Line" / Arbitrage Detection
**Current state**: Odds toast shows all books side-by-side but doesn't highlight which book has the best odds for Fighter A vs Fighter B.

**Proposed fix**: Compute `max(decOdds[0] across books)` and `max(decOdds[1] across books)` + flag if `1/maxA + 1/maxB < 1.0` (arbitrage / no-vig opportunity).

### Gap 2.4: Market Data Not Fed Into Kelly Engine Automatically
**Current state**: "Market No-Vig" is one of 3 Probability Drive modes, but the engine only gets market prices if the USER manually populates a card THEN clicks "Market No-Vig" toggle. The upcoming tile has live odds but there's no one-click "Populate + Use Market Prices" flow.

**Proposed fix**: Add a per-tile "⚡ Populate with LIVE odds" button that (1) populates the fights into workspace AND (2) fetches odds + sets Probability Drive to "Market" automatically.

---

## 3. Files and Modules to Edit

| Priority | File | Change Scope |
|----------|------|--------------|
| **CORE** (unchanged, no edits needed if gap fixes skipped) | | |
| P0 (stable, no touch) | backend/.env | API key already set · NO edits required |
| P0 (stable, no touch) | backend/src/routes/schedule.js | Live pipeline works · only edit if adding endpoints |
| P0 (stable, no touch) | backend/src/index.js | Route mounts already done |
| P0 (stable, no touch) | js/app.js | Fetch handlers exist · only edit if adding features |
| **IF ENHANCEMENTS APPROVED** | | |
| P1 | backend/src/routes/schedule.js | Add `GET /api/schedule/config` endpoint (gap 2.2) |
| P1 | js/app.js | Background headliner-odds hydration + DOM injection (gap 2.1) |
| P1 | js/app.js | `renderOddsToast()` best-line + arb flag (gap 2.3) |
| P2 | js/app.js | Add "⚡ Populate LIVE" button per tile click flow (gap 2.4) |
| P2 | index.html | Expose config chip in the dashboard header meta bar |

---

## 4. Step-by-Step Modification Plan

### Phase 0: VALIDATION (No Code Changes — Confirm Current Pipeline)
**Goal**: Prove to the user that the live odds pipeline is 100% functional RIGHT NOW via CLI.

Step 0.1: Start backend server
```
cd backend && npm start
```

Step 0.2: Test upcoming endpoint (direct curl/PS)
```
Invoke-RestMethod http://localhost:8787/api/schedule/upcoming | ConvertTo-Json -Depth 6
```
→ Expected: `provider: "odds-api.io"`, `_bookmakers: ["1xbet","Stake"]`, `events[].fights[]._eventId` present

Step 0.3: Test odds endpoint (pick an eventId from step 2)
```
Invoke-RestMethod http://localhost:8787/api/schedule/odds/{EVENT_ID} | ConvertTo-Json -Depth 6
```
→ Expected: non-empty `markets[0].books[]` if fight is close enough; otherwise `_note: "No odds posted"`

Step 0.4: Verify X-Cache header behavior (HIT on 2nd call)
```
(Invoke-WebRequest http://localhost:8787/api/schedule/upcoming).Headers['X-Cache']
```
→ Expected: first call = `MISS`, second call within 3 min = `HIT`

---

### Phase 1: Enhancement — Tile Row Background Odds Hydration (Gap 2.1)

Step 1.1: In [js/app.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js) AFTER the existing `refreshUpcoming()` tile render finishes, add a new async IIFE `hydrateHeadlinerOddsBackground()`:
- Iterate `UPCOMING_CACHE` events
- For UFC / top-tier events only: pick `fights[fights.length-1]` (headliner = last in API list)
- Throttle to 2 parallel requests at a time (avoid free-tier rate limit 100/hr exhaustion)
- `fetch(BASE + "/api/schedule/odds/" + eventId)` per headliner
- On success: walk DOM to find the `.upc-tile[data-tile-key=…] .upc-fight-row` matching fighter names
- Inject odds chips `<span class="upc-inline-odds …">1xbet 2.30 / Stake 2.28</span>` into the row
- If no books yet: inject a lighter "⏳ Lines pending" chip instead of "not posted"

Step 1.2: Add `window.__ODDS_HYDRATE_ABORT` controller to cancel on `bust:true` refresh to prevent stale injection.

---

### Phase 2: Enhancement — Config Endpoint + Dashboard Chip (Gap 2.2)

Step 2.1: In [schedule.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/backend/src/routes/schedule.js), add:
```js
router.get("/config", (req, res) => {
  res.json({
    provider: process.env.ODDS_API_PROVIDER || "STUB_DEMO",
    hasKey: !!process.env.ODDS_API_KEY,
    bookmakers: getBookmakersEnv(),
    cacheTtlSec: Math.round(CACHE_TTL_MS / 1000),
    baseUrl: ODDS_API_BASE,
    sport: ODDS_API_SPORT
  });
});
```

Step 2.2: In [index.html](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/index.html) dashboard meta bar, add a tiny `#oddsConfigChip` element.

Step 2.3: In [js/app.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js) `init()` or alongside schedule fetch, call `/api/schedule/config` and populate the chip with: `📡 odds-api.io · books: 1xbet, Stake · cache 3m`.

---

### Phase 3: Enhancement — Best-Line / Arb Detection (Gap 2.3)

Step 3.1: In [js/app.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js) odds toast renderer (around L3103), compute:
```js
const bestA = Math.max(...best.books.map(b => (b.decOdds||[])[0] || 1));
const bestB = Math.max(...best.books.map(b => (b.decOdds||[])[1] || 1));
const vigSum = 1/bestA + 1/bestB;
const isArb = vigSum < 0.995;
```

Step 3.2: Append to toast: `BEST LINE: A=${bestA.toFixed(2)} / B=${bestB.toFixed(2)}` + if arb → `🟢 ARBITRAGE OPPORTUNITY (vig=${(vigSum*100).toFixed(1)}%)` in green. If not arb → show normal vig `(vig=${(vigSum*100-100).toFixed(1)}%)`.

---

### Phase 4: Enhancement — "Populate LIVE" One-Click (Gap 2.4)

Step 4.1: In [js/app.js](file:///c:/Users/tOp%20laptOps/Desktop/TRAIE%20PROJECTS/ufc/js/app.js) tile template, add a 3rd button alongside Pin/Hide:
```html
<button type="button" class="upc-pop-live-btn …">⚡ Pop LIVE</button>
```

Step 4.2: Click handler:
1. Call existing `populateFightsFromEvent(ev, slots)` to add fights to workspace
2. Immediately call `fetchLiveOdds()` for each populated fight's `_eventId`
3. For each fight in workspace that has a matching live book → set `fight.market = decOdds`
4. Set the Probability Drive toggle to `market` mode for the card
5. Trigger `recalcAllCards()` to re-run Kelly/MC with market prices

---

## 5. Dependencies & Considerations

### 5.1 Rate Limit Budget (CRITICAL)
- **Free tier = 100 req/hr, 500 req/day hard cap** on `odds-api.io`
- **Hydration risk**: Background Phase 1 fetches 1 odds call per tile × (say) 10 upcoming cards = 10 req / refresh. If user refreshes 10×/hr, that's 100 req → **rate limit hit**.
- **Mitigation**: Hydrate ONLY UFC (not LFA/PFL/etc), hydrate ONLY HEADLINER (1 per card), throttle ≤2 parallel, skip if `X-Cache: HIT` path, add a `__ODDS_HYDRATE_LAST_RUN` timestamp that blocks re-hydration for 5 min even if user clicks refresh.

### 5.2 Bookmaker Tier Lock-In
- Current: `1xbet, Stake` (international books). If user wants DraftKings/FanDuel/Bet365 (US books), they need a **paid tier** of odds-api.io. The auto-recovery regex in `fetchLiveOdds()` already handles this (extracts allowed list from error + retries).

### 5.3 No Breaking Changes
- ALL enhancements are ADDITIVE only. The core `/upcoming` and `/odds/:id` endpoints remain byte-stable; no payload shape changes means no workspace/Kelly engine regressions.

### 5.4 Browser-Server Parity (Math)
- No changes to `fightnomics.js`, `services/strategies.js`, or calculation routes. 60/60 smoke remains green.

---

## 6. Risk Handling

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Free-tier rate limit exhaust from background hydrate | Medium | High | Hydrate UFC headliners only, 5-min global re-hydrate lock, 2-at-a-time concurrency, localStorage cache fallback |
| odds-api.io service downtime | Low | Medium | Existing FALLBACK-STUB already works; Phase 1 hydration failures are silent (no DOM change) |
| CORS issue on static deployment | Low | Low | `CORS_ORIGINS=*` already set; production origins pre-allowed in .env |
| Fight ID mismatch (headliner fight names ≠ API fighter strings) | Medium | Low | Match by fuzzy `includes()` both directions + inject a debug `data-debug-mismatch` attribute for inspection if not found |
| Supabase key exposure risk | N/A | N/A | Odds route uses SERVER-SIDE API key only; NEVER exposed to browser (proxy pattern is correct, no change needed) |

---

## 7. Validation Checklist (Post-Implementation)

- [ ] Backend syntax: `node --check backend/src/routes/schedule.js` → exit 0
- [ ] Frontend syntax: `node --check js/app.js` → exit 0
- [ ] Smoke tests: `backend/scripts/smoke_calculate.js` → 60/60 pass
- [ ] `/api/schedule/config` returns correct bookmakers list
- [ ] On fresh browser load: UFC 330 headliner tile row shows ⚡ LIVE odds chips within 10s (no button click)
- [ ] Odds button toast now highlights best line + shows vig percentage
- [ ] "⚡ Pop LIVE" button → fights land in workspace + Market Drive mode activated + Kelly recalculates with market prices
- [ ] Refresh upcoming (bust:true) → hydrated odds refresh without flicker loss
- [ ] After 10 manual refresh clicks in 1 minute → hydration lock engages, no API calls made (check Network tab)
