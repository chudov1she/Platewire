-- AlterTable
ALTER TABLE "Official" ADD COLUMN "umpScorecardName" TEXT;

-- CreateIndex
CREATE INDEX "Official_umpScorecardName_idx" ON "Official"("umpScorecardName");

-- CreateTable
CREATE TABLE "UmpScorecardProfile" (
    "id" TEXT NOT NULL,
    "umpireName" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "gamesSample" INTEGER NOT NULL DEFAULT 0,
    "overallAccuracy" DOUBLE PRECISION,
    "accuracyAboveX" DOUBLE PRECISION,
    "consistency" DOUBLE PRECISION,
    "favorAbsMean" DOUBLE PRECISION,
    "totalRunImpactMean" DOUBLE PRECISION,
    "weightedScore" DOUBLE PRECISION,
    "calledPitches" INTEGER,
    "calledCorrect" INTEGER,
    "calledWrong" INTEGER,
    "metricsJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UmpScorecardProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UmpScorecardProfile_umpireName_key" ON "UmpScorecardProfile"("umpireName");

-- CreateIndex
CREATE UNIQUE INDEX "UmpScorecardProfile_nameKey_key" ON "UmpScorecardProfile"("nameKey");

-- CreateIndex
CREATE INDEX "UmpScorecardProfile_fetchedAt_idx" ON "UmpScorecardProfile"("fetchedAt");
