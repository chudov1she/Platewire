-- CreateTable
CREATE TABLE "F5OddsSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "winlineEventId" INTEGER NOT NULL,
    "flipped" BOOLEAN NOT NULL DEFAULT false,
    "moneylineJson" JSONB,
    "totalsJson" JSONB NOT NULL,
    "handicapsJson" JSONB NOT NULL,
    "mainTotalJson" JSONB,
    "mainHandicapJson" JSONB,
    "ok" BOOLEAN NOT NULL,
    "rawMarketCount" INTEGER NOT NULL DEFAULT 0,
    "missingJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "F5OddsSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "F5OddsSnapshot_gameId_fetchedAt_idx" ON "F5OddsSnapshot"("gameId", "fetchedAt");

-- AddForeignKey
ALTER TABLE "F5OddsSnapshot" ADD CONSTRAINT "F5OddsSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
