-- CreateTable
CREATE TABLE "Official" (
    "id" TEXT NOT NULL,
    "mlbOfficialId" INTEGER NOT NULL,
    "fullName" TEXT,
    "bioJson" JSONB,
    "bioFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Official_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameOfficial" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameOfficial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficialFeature" (
    "id" TEXT NOT NULL,
    "officialId" TEXT NOT NULL,
    "mlbOfficialId" INTEGER NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "gamesSample" INTEGER NOT NULL DEFAULT 0,
    "asOf" DATE,
    "source" TEXT NOT NULL DEFAULT 'statcast_ump',
    "kRate" DOUBLE PRECISION,
    "bbRate" DOUBLE PRECISION,
    "calledStrikeRate" DOUBLE PRECISION,
    "calledBallRate" DOUBLE PRECISION,
    "metricsJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OfficialFeature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Official_mlbOfficialId_key" ON "Official"("mlbOfficialId");

-- CreateIndex
CREATE INDEX "GameOfficial_officialId_idx" ON "GameOfficial"("officialId");

-- CreateIndex
CREATE INDEX "GameOfficial_role_idx" ON "GameOfficial"("role");

-- CreateIndex
CREATE UNIQUE INDEX "GameOfficial_gameId_role_key" ON "GameOfficial"("gameId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "OfficialFeature_officialId_key" ON "OfficialFeature"("officialId");

-- CreateIndex
CREATE INDEX "OfficialFeature_mlbOfficialId_idx" ON "OfficialFeature"("mlbOfficialId");

-- CreateIndex
CREATE INDEX "OfficialFeature_ready_idx" ON "OfficialFeature"("ready");

-- AddForeignKey
ALTER TABLE "GameOfficial" ADD CONSTRAINT "GameOfficial_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameOfficial" ADD CONSTRAINT "GameOfficial_officialId_fkey" FOREIGN KEY ("officialId") REFERENCES "Official"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialFeature" ADD CONSTRAINT "OfficialFeature_officialId_fkey" FOREIGN KEY ("officialId") REFERENCES "Official"("id") ON DELETE CASCADE ON UPDATE CASCADE;
