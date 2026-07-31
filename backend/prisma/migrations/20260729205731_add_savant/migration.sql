-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "mlbPlayerId" INTEGER NOT NULL,
    "fullName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavantPreviewSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "mlbGamePk" INTEGER NOT NULL,
    "gameDate" TEXT,
    "hasLineup" BOOLEAN NOT NULL DEFAULT false,
    "hasProbable" BOOLEAN NOT NULL DEFAULT false,
    "previewJson" JSONB NOT NULL,
    "summaryJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavantPreviewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavantGamefeedSnapshot" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "mlbGamePk" INTEGER NOT NULL,
    "gameStatusCode" TEXT,
    "gameStatus" TEXT,
    "cacheKey" TEXT,
    "cacheHit" TEXT,
    "scoreboardJson" JSONB,
    "statsJson" JSONB,
    "currentPlayJson" JSONB,
    "topPerformersJson" JSONB,
    "rawJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavantGamefeedSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameLineupPlayer" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "battingOrder" INTEGER NOT NULL,
    "playerId" TEXT,
    "mlbPlayerId" INTEGER,
    "fullName" TEXT,
    "xwoba" DOUBLE PRECISION,
    "xslg" DOUBLE PRECISION,
    "xba" DOUBLE PRECISION,
    "barrelRate" DOUBLE PRECISION,
    "hardHitPct" DOUBLE PRECISION,

    CONSTRAINT "GameLineupPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_mlbPlayerId_key" ON "Player"("mlbPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "SavantPreviewSnapshot_gameId_key" ON "SavantPreviewSnapshot"("gameId");

-- CreateIndex
CREATE INDEX "SavantPreviewSnapshot_mlbGamePk_idx" ON "SavantPreviewSnapshot"("mlbGamePk");

-- CreateIndex
CREATE INDEX "SavantPreviewSnapshot_hasLineup_idx" ON "SavantPreviewSnapshot"("hasLineup");

-- CreateIndex
CREATE UNIQUE INDEX "SavantGamefeedSnapshot_gameId_key" ON "SavantGamefeedSnapshot"("gameId");

-- CreateIndex
CREATE INDEX "SavantGamefeedSnapshot_mlbGamePk_idx" ON "SavantGamefeedSnapshot"("mlbGamePk");

-- CreateIndex
CREATE INDEX "SavantGamefeedSnapshot_gameStatusCode_idx" ON "SavantGamefeedSnapshot"("gameStatusCode");

-- CreateIndex
CREATE INDEX "GameLineupPlayer_gameId_side_idx" ON "GameLineupPlayer"("gameId", "side");

-- CreateIndex
CREATE INDEX "GameLineupPlayer_mlbPlayerId_idx" ON "GameLineupPlayer"("mlbPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "GameLineupPlayer_gameId_side_battingOrder_key" ON "GameLineupPlayer"("gameId", "side", "battingOrder");

-- AddForeignKey
ALTER TABLE "SavantPreviewSnapshot" ADD CONSTRAINT "SavantPreviewSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavantGamefeedSnapshot" ADD CONSTRAINT "SavantGamefeedSnapshot_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLineupPlayer" ADD CONSTRAINT "GameLineupPlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLineupPlayer" ADD CONSTRAINT "GameLineupPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
