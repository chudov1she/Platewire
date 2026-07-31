-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL,
    "gameId" TEXT,
    "mlbGamePk" INTEGER,
    "job" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "metaJson" JSONB,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PipelineEvent_job_createdAt_idx" ON "PipelineEvent"("job", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_gameId_createdAt_idx" ON "PipelineEvent"("gameId", "createdAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_createdAt_idx" ON "PipelineEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
