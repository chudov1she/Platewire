CREATE TABLE IF NOT EXISTS "OfficeCursor" (
  "gameId" TEXT NOT NULL,
  "windowKey" TEXT,
  "lineupKey" TEXT,
  "stageKey" TEXT,
  "finalKey" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfficeCursor_pkey" PRIMARY KEY ("gameId")
);

DO $$ BEGIN
  ALTER TABLE "OfficeCursor"
    ADD CONSTRAINT "OfficeCursor_gameId_fkey"
    FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
