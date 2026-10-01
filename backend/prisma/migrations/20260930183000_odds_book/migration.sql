-- Full classified Winline board on each odds snapshot.
ALTER TABLE "F5OddsSnapshot" ADD COLUMN IF NOT EXISTS "marketsJson" JSONB;
