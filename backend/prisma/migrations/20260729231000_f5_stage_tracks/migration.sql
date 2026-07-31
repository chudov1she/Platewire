-- Keep latest snapshot per game as prematch; drop older history rows
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "gameId" ORDER BY "fetchedAt" DESC) AS rn
  FROM "F5OddsSnapshot"
)
DELETE FROM "F5OddsSnapshot"
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

ALTER TABLE "F5OddsSnapshot" ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'prematch';
ALTER TABLE "F5OddsSnapshot" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "F5OddsSnapshot_gameId_stage_key" ON "F5OddsSnapshot"("gameId", "stage");
