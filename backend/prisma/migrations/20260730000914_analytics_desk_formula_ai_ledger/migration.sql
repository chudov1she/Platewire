-- CreateTable
CREATE TABLE "FormulaVersion" (
    "id" TEXT NOT NULL,
    "versionLabel" TEXT NOT NULL,
    "base" TEXT NOT NULL DEFAULT 'v42',
    "specJson" JSONB NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'system',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormulaVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaProduction" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "versionId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormulaProduction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentProposal" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "patchJson" JSONB NOT NULL,
    "baselineVersionId" TEXT NOT NULL,
    "baselineMetricsJson" JSONB NOT NULL,
    "proposedMetricsJson" JSONB NOT NULL,
    "createdFormulaVersionId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "F5LedgerEntry" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "pickMarket" TEXT,
    "pickSide" TEXT,
    "pickLine" DOUBLE PRECISION,
    "decimalOdds" DOUBLE PRECISION,
    "modelProb" DOUBLE PRECISION,
    "valuePct" DOUBLE PRECISION,
    "roiPct" DOUBLE PRECISION,
    "confidenceTier" TEXT,
    "stakeUnits" DOUBLE PRECISION,
    "formulaVersionId" TEXT NOT NULL,
    "signalsJson" JSONB,
    "dossierDigestJson" JSONB,
    "riskFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rationale" TEXT,
    "aiTraceId" TEXT,
    "resultStatus" TEXT NOT NULL DEFAULT 'pending',
    "f5HomeRuns" INTEGER,
    "f5AwayRuns" INTEGER,
    "profitUnits" DOUBLE PRECISION,
    "settledAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "F5LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecisionTrace" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "track" TEXT NOT NULL,
    "promptJson" JSONB NOT NULL,
    "rawOutputJson" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecisionTrace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormulaVersion_versionLabel_key" ON "FormulaVersion"("versionLabel");

-- CreateIndex
CREATE INDEX "FormulaVersion_createdAt_idx" ON "FormulaVersion"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FormulaProduction_versionId_key" ON "FormulaProduction"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentProposal_createdFormulaVersionId_key" ON "AgentProposal"("createdFormulaVersionId");

-- CreateIndex
CREATE INDEX "AgentProposal_status_createdAt_idx" ON "AgentProposal"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "F5LedgerEntry_aiTraceId_key" ON "F5LedgerEntry"("aiTraceId");

-- CreateIndex
CREATE INDEX "F5LedgerEntry_resultStatus_idx" ON "F5LedgerEntry"("resultStatus");

-- CreateIndex
CREATE INDEX "F5LedgerEntry_track_capturedAt_idx" ON "F5LedgerEntry"("track", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "F5LedgerEntry_gameId_track_key" ON "F5LedgerEntry"("gameId", "track");

-- CreateIndex
CREATE INDEX "AiDecisionTrace_gameId_track_idx" ON "AiDecisionTrace"("gameId", "track");

-- AddForeignKey
ALTER TABLE "FormulaProduction" ADD CONSTRAINT "FormulaProduction_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "FormulaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentProposal" ADD CONSTRAINT "AgentProposal_createdFormulaVersionId_fkey" FOREIGN KEY ("createdFormulaVersionId") REFERENCES "FormulaVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "F5LedgerEntry" ADD CONSTRAINT "F5LedgerEntry_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "F5LedgerEntry" ADD CONSTRAINT "F5LedgerEntry_formulaVersionId_fkey" FOREIGN KEY ("formulaVersionId") REFERENCES "FormulaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "F5LedgerEntry" ADD CONSTRAINT "F5LedgerEntry_aiTraceId_fkey" FOREIGN KEY ("aiTraceId") REFERENCES "AiDecisionTrace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
