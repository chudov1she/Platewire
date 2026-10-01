CREATE TABLE "FormulaVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "valueThreshold" DOUBLE PRECISION NOT NULL,
    "overround" DOUBLE PRECISION NOT NULL,
    "constantsJson" JSONB NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormulaVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormulaVersion_version_key" ON "FormulaVersion"("version");

CREATE TABLE "FormulaProduction" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "versionId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FormulaProduction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FormulaProduction_versionId_key" ON "FormulaProduction"("versionId");

ALTER TABLE "FormulaProduction" ADD CONSTRAINT "FormulaProduction_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "FormulaVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CollectorSource" (
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "configJson" JSONB NOT NULL,
    "notes" TEXT,
    "lastStatus" TEXT,
    "lastPayload" JSONB,
    "lastRunAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CollectorSource_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "OfficeRun" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "matchup" TEXT,
    "reason" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "formula" TEXT,
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "OfficeRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OfficeRun_startedAt_idx" ON "OfficeRun"("startedAt");
CREATE INDEX "OfficeRun_gameId_startedAt_idx" ON "OfficeRun"("gameId", "startedAt");
