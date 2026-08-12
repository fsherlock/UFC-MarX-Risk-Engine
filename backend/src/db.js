/* db.js — Supabase-backed OR in-memory fallback.
 * If SUPABASE_URL + SERVICE_ROLE_KEY are set in env → Supabase Postgres (recommended).
 * If not → in-memory { cards: [] } map (DEMO ONLY, wiped on restart).
 */
"use strict";
require("dotenv").config();
let supabase = null;
let memoryStore = null;
const { createClient } = (() => {
  try { return require("@supabase/supabase-js"); }
  catch (e) { return { createClient: null }; }
})();
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && createClient) {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
  });
} else {
  memoryStore = { cards: new Map(), bets: new Map() };
}
const MODE = supabase ? "SUPABASE" : "MEMORY";

function newId() {
  try { return require("nanoid").nanoid(12); }
  catch(_) { return Math.random().toString(36).slice(2, 14); }
}

async function saveCard(userId, payload, shareToken) {
  const card = {
    id: newId(),
    user_id: userId || "anon",
    share_token: shareToken || newId(),
    payload_json: JSON.stringify(payload || {}),
    note: payload?.note || "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (MODE === "SUPABASE") {
    const { data, error } = await supabase.from("cards").insert([{
      id: card.id,
      user_id: card.user_id, share_token: card.share_token,
      payload: payload, note: card.note
    }]).select("*").single();
    if (error) throw error;
    return data;
  }
  memoryStore.cards.set(card.id, card);
  return card;
}
async function listCards(userId) {
  if (MODE === "SUPABASE") {
    const { data, error } = await supabase.from("cards").select("id, share_token, note, payload, created_at, updated_at").eq("user_id", userId || "anon").order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }
  return Array.from(memoryStore.cards.values())
    .filter(c => c.user_id === (userId || "anon"))
    .sort((a,b) => b.created_at.localeCompare(a.created_at))
    .map(c => ({ id: c.id, share_token: c.share_token, note: c.note, payload_json: c.payload_json, created_at: c.created_at, updated_at: c.updated_at }));
}
async function getCardByShare(token) {
  if (MODE === "SUPABASE") {
    const { data, error } = await supabase.from("cards").select("*").eq("share_token", token).maybeSingle();
    if (error) throw error;
    return data || null;
  }
  for (const c of memoryStore.cards.values()) if (c.share_token === token) return c;
  return null;
}
async function saveBet(userId, bet) {
  const row = {
    id: newId(), user_id: userId || "anon",
    card_id: bet?.card_id || null,
    payload_json: JSON.stringify(bet || {}),
    outcome: bet?.outcome || null, settled_at: bet?.settled_at || null,
    created_at: new Date().toISOString()
  };
  if (MODE === "SUPABASE") {
    const { data, error } = await supabase.from("bets").insert([{
      id: row.id, user_id: row.user_id, card_id: row.card_id,
      payload: bet, outcome: row.outcome, settled_at: row.settled_at
    }]).select("*").single();
    if (error) throw error; return data;
  }
  memoryStore.bets.set(row.id, row);
  return row;
}

async function listBetsSupabase(userId, cardId) {
  let q = supabase.from("bets").select("*").eq("user_id", userId || "anon");
  if (cardId) q = q.eq("card_id", cardId);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}
function listBetsMemory(userId, cardId) {
  return Array.from(memoryStore.bets.values())
    .filter(b => b.user_id === (userId || "anon"))
    .filter(b => !cardId || b.card_id === cardId)
    .sort((a,b) => b.created_at.localeCompare(a.created_at));
}

async function getBetByIdSupabase(id, userId) {
  const { data, error } = await supabase.from("bets").select("*").eq("id", id).eq("user_id", userId || "anon").maybeSingle();
  if (error) throw error;
  return data || null;
}
function getBetByIdMemory(id, userId) {
  const b = memoryStore.bets.get(id);
  if (!b || b.user_id !== (userId || "anon")) return null;
  return b;
}

async function settleBetSupabase(id, userId, outcome) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from("bets")
    .update({ outcome, settled_at: now })
    .eq("id", id).eq("user_id", userId || "anon")
    .select("*").single();
  if (error) throw error;
  return data || null;
}
async function unsettleBetSupabase(id, userId) {
  const { data, error } = await supabase.from("bets")
    .update({ outcome: null, settled_at: null })
    .eq("id", id).eq("user_id", userId || "anon")
    .select("*").single();
  if (error) throw error;
  return data || null;
}
function settleBetMemory(id, userId, outcome) {
  const b = memoryStore.bets.get(id);
  if (!b || b.user_id !== (userId || "anon")) return null;
  b.outcome = outcome;
  b.settled_at = new Date().toISOString();
  if (b.payload_json && typeof b.payload_json === "string") {
    try { const p = JSON.parse(b.payload_json); p.outcome = outcome; p.settled_at = b.settled_at; b.payload_json = JSON.stringify(p); } catch(_) {}
  }
  memoryStore.bets.set(id, b);
  return b;
}
function unsettleBetMemory(id, userId) {
  const b = memoryStore.bets.get(id);
  if (!b || b.user_id !== (userId || "anon")) return null;
  b.outcome = null;
  b.settled_at = null;
  if (b.payload_json && typeof b.payload_json === "string") {
    try { const p = JSON.parse(b.payload_json); p.outcome = null; p.settled_at = null; b.payload_json = JSON.stringify(p); } catch(_) {}
  }
  memoryStore.bets.set(id, b);
  return b;
}

async function deleteBetSupabase(id, userId) {
  const { error } = await supabase.from("bets").delete().eq("id", id).eq("user_id", userId || "anon");
  if (error) throw error;
  return true;
}
function deleteBetMemory(id, userId) {
  const b = memoryStore.bets.get(id);
  if (!b || b.user_id !== (userId || "anon")) return false;
  memoryStore.bets.delete(id);
  return true;
}

async function getCardByIdSupabase(id, userId) {
  const { data, error } = await supabase.from("cards").select("*").eq("id", id).eq("user_id", userId || "anon").maybeSingle();
  if (error) throw error;
  return data || null;
}
function getCardByIdMemory(id, userId) {
  const c = memoryStore.cards.get(id);
  if (!c || c.user_id !== (userId || "anon")) return null;
  return c;
}

async function updateCardSupabase(id, userId, patch) {
  const now = new Date().toISOString();
  const row = { updated_at: now };
  if (patch && typeof patch.note === "string") row.note = patch.note;
  if (patch && patch.payload !== undefined) row.payload = patch.payload;
  const { data, error } = await supabase.from("cards").update(row).eq("id", id).eq("user_id", userId || "anon").select("*").single();
  if (error) throw error;
  return data || null;
}
function updateCardMemory(id, userId, patch) {
  const c = memoryStore.cards.get(id);
  if (!c || c.user_id !== (userId || "anon")) return null;
  c.updated_at = new Date().toISOString();
  if (patch && typeof patch.note === "string") c.note = patch.note;
  if (patch && patch.payload !== undefined) {
    c.payload_json = typeof patch.payload === "string" ? patch.payload : JSON.stringify(patch.payload || {});
  }
  memoryStore.cards.set(id, c);
  return c;
}

async function deleteCardSupabase(id, userId) {
  const { error } = await supabase.from("cards").delete().eq("id", id).eq("user_id", userId || "anon");
  if (error) throw error;
  return true;
}
function deleteCardMemory(id, userId) {
  const c = memoryStore.cards.get(id);
  if (!c || c.user_id !== (userId || "anon")) return false;
  memoryStore.cards.delete(id);
  return true;
}

module.exports = {
  MODE, saveCard, listCards, getCardByShare, saveBet, newId, isSupabase: !!supabase,
  listBetsSupabase, listBetsMemory,
  getBetByIdSupabase, getBetByIdMemory,
  settleBetSupabase, unsettleBetSupabase,
  settleBetMemory, unsettleBetMemory,
  deleteBetSupabase, deleteBetMemory,
  getCardByIdSupabase, getCardByIdMemory,
  updateCardSupabase, updateCardMemory,
  deleteCardSupabase, deleteCardMemory,
};
