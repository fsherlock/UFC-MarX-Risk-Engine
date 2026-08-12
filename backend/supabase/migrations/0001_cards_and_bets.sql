-- Supabase migration 0001 — UFC MarX Risk Engine Tier 1 tables
-- Run via: Supabase dashboard → SQL Editor → New Query → paste, Run
-- OR locally: node backend/scripts/migrate_up.js  (if SUPABASE_SERVICE_ROLE_KEY in env)

CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY,                  -- nanoid() 12 chars
    user_id TEXT NOT NULL DEFAULT 'anon', -- Supabase auth.uid() OR 'anon' for demo
    share_token TEXT UNIQUE NOT NULL,     -- public permalink token
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,  -- entire fight/odds/confidence state
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cards_user_id ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_cards_created_at ON cards(created_at DESC);

CREATE TABLE IF NOT EXISTS bets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'anon',
    card_id TEXT REFERENCES cards(id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    outcome TEXT, -- 'WIN' | 'LOSS' | 'PUSH' | null (pending)
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bets_user_id ON bets(user_id);
CREATE INDEX IF NOT EXISTS idx_bets_settled ON bets(settled_at DESC) WHERE settled_at IS NOT NULL;

-- RLS (Row Level Security): users see only their own cards/bets (except share-tokens public)
ALTER TABLE cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cards_select_self ON cards;
CREATE POLICY cards_select_self ON cards FOR SELECT
  USING (user_id = auth.uid()::text OR share_token IS NOT NULL);

DROP POLICY IF EXISTS cards_write_self ON cards;
CREATE POLICY cards_write_self ON cards FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

DROP POLICY IF EXISTS bets_select_self ON bets;
CREATE POLICY bets_select_self ON bets FOR SELECT
  USING (user_id = auth.uid()::text);

DROP POLICY IF EXISTS bets_write_self ON bets;
CREATE POLICY bets_write_self ON bets FOR ALL
  USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

-- Auto-updated_at trigger (supabase common pattern)
CREATE OR REPLACE FUNCTION fn_trigger_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trigger_cards_set_updated_at ON cards;
CREATE TRIGGER trigger_cards_set_updated_at
  BEFORE UPDATE ON cards
  FOR EACH ROW EXECUTE FUNCTION fn_trigger_set_updated_at();
