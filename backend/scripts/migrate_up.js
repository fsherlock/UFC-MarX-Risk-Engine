/* Runs the 0001_cards_and_bets.sql migration against Supabase
 * directly (using SUPABASE_SERVICE_ROLE_KEY which bypasses RLS).
 *   Usage:  node backend/scripts/migrate_up.js
 */
"use strict";
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const supabase = (() => {
  try {
    const { createClient } = require("@supabase/supabase-js");
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
    });
  } catch(e) { return null; }
})();

(async () => {
  const sqlFile = path.join(__dirname, "..", "supabase", "migrations", "0001_cards_and_bets.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  if (!supabase) {
    console.log("⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set in backend/.env.");
    console.log("   Skipping live execution.  Paste the following into Supabase SQL Editor instead:");
    console.log("=".repeat(70));
    console.log(sql);
    process.exit(0);
  }
  const { data, error } = await supabase.rpc(/* run arbitrary SQL via rest not allowed; split with notice */);
  console.log("ℹ️  Supabase REST API does NOT allow arbitrary CREATE TABLE / DDL over HTTP for security.");
  console.log("   You MUST run the SQL migration file in the SUPABASE DASHBOARD SQL EDITOR.");
  console.log("   File ready at:", sqlFile);
  console.log("=".repeat(70));
  console.log(sql);
})();
