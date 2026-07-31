-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "batSide" TEXT,
ADD COLUMN     "bioFetchedAt" TIMESTAMP(3),
ADD COLUMN     "bioJson" JSONB,
ADD COLUMN     "birthDate" TEXT,
ADD COLUMN     "pitchHand" TEXT,
ADD COLUMN     "primaryPosition" TEXT;

-- CreateTable
CREATE TABLE "PlayerFeature" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "mlbPlayerId" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "gamesSample" INTEGER NOT NULL DEFAULT 0,
    "asOf" DATE,
    "source" TEXT NOT NULL,
    "seasonOps" DOUBLE PRECISION,
    "seasonAvg" DOUBLE PRECISION,
    "seasonObp" DOUBLE PRECISION,
    "seasonSlg" DOUBLE PRECISION,
    "seasonEra" DOUBLE PRECISION,
    "seasonWhip" DOUBLE PRECISION,
    "seasonIp" DOUBLE PRECISION,
    "seasonGames" INTEGER,
    "seasonGamesStarted" INTEGER,
    "l5Ops" DOUBLE PRECISION,
    "l5Avg" DOUBLE PRECISION,
    "l5Era" DOUBLE PRECISION,
    "l5Whip" DOUBLE PRECISION,
    "l5Ip" DOUBLE PRECISION,
    "l5Games" INTEGER NOT NULL DEFAULT 0,
    "l10Ops" DOUBLE PRECISION,
    "l10Avg" DOUBLE PRECISION,
    "l10Era" DOUBLE PRECISION,
    "l10Whip" DOUBLE PRECISION,
    "l10Ip" DOUBLE PRECISION,
    "l10Games" INTEGER NOT NULL DEFAULT 0,
    "metricsJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatcastPitch" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "mlbGamePk" INTEGER NOT NULL,
    "atBatNumber" INTEGER NOT NULL,
    "pitchNumber" INTEGER NOT NULL,
    "batterId" TEXT,
    "pitcherId" TEXT,
    "sourceBatterId" INTEGER,
    "sourcePitcherId" INTEGER,
    "pitchType" TEXT,
    "pitchName" TEXT,
    "gameDate" TEXT,
    "events" TEXT,
    "description" TEXT,
    "inning" INTEGER,
    "inningHalf" TEXT,
    "balls" INTEGER,
    "strikes" INTEGER,
    "outs" INTEGER,
    "homeTeam" TEXT,
    "awayTeam" TEXT,
    "releaseSpeed" DOUBLE PRECISION,
    "releasePosX" DOUBLE PRECISION,
    "releasePosZ" DOUBLE PRECISION,
    "pfxX" DOUBLE PRECISION,
    "pfxZ" DOUBLE PRECISION,
    "plateX" DOUBLE PRECISION,
    "plateZ" DOUBLE PRECISION,
    "launchSpeed" DOUBLE PRECISION,
    "launchAngle" DOUBLE PRECISION,
    "hitDistanceSc" DOUBLE PRECISION,
    "estimatedBa" DOUBLE PRECISION,
    "estimatedWoba" DOUBLE PRECISION,
    "estimatedSlg" DOUBLE PRECISION,
    "wobaValue" DOUBLE PRECISION,
    "babipValue" DOUBLE PRECISION,
    "isoValue" DOUBLE PRECISION,
    "deltaHomeWinExp" DOUBLE PRECISION,
    "deltaRunExp" DOUBLE PRECISION,
    "batSpeed" DOUBLE PRECISION,
    "swingLength" DOUBLE PRECISION,
    "armAngle" DOUBLE PRECISION,
    "attackAngle" DOUBLE PRECISION,
    "rawRowJson" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StatcastPitch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerFeature_mlbPlayerId_role_idx" ON "PlayerFeature"("mlbPlayerId", "role");

-- CreateIndex
CREATE INDEX "PlayerFeature_ready_idx" ON "PlayerFeature"("ready");

-- CreateIndex
CREATE INDEX "PlayerFeature_fetchedAt_idx" ON "PlayerFeature"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerFeature_playerId_role_season_key" ON "PlayerFeature"("playerId", "role", "season");

-- CreateIndex
CREATE INDEX "StatcastPitch_mlbGamePk_idx" ON "StatcastPitch"("mlbGamePk");

-- CreateIndex
CREATE INDEX "StatcastPitch_gameId_inning_idx" ON "StatcastPitch"("gameId", "inning");

-- CreateIndex
CREATE UNIQUE INDEX "StatcastPitch_gameId_atBatNumber_pitchNumber_key" ON "StatcastPitch"("gameId", "atBatNumber", "pitchNumber");

-- AddForeignKey
ALTER TABLE "PlayerFeature" ADD CONSTRAINT "PlayerFeature_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatcastPitch" ADD CONSTRAINT "StatcastPitch_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatcastPitch" ADD CONSTRAINT "StatcastPitch_batterId_fkey" FOREIGN KEY ("batterId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatcastPitch" ADD CONSTRAINT "StatcastPitch_pitcherId_fkey" FOREIGN KEY ("pitcherId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;
