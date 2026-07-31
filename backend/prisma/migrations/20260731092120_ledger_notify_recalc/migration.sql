-- AlterTable
ALTER TABLE "F5LedgerEntry" ADD COLUMN     "captureReason" TEXT,
ADD COLUMN     "lineupFingerprint" TEXT,
ADD COLUMN     "notifyBrief" TEXT,
ADD COLUMN     "spFingerprint" TEXT;

-- CreateTable
CREATE TABLE "TelegramNotifyState" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payloadJson" JSONB,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramNotifyState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramNotifyState_gameId_key" ON "TelegramNotifyState"("gameId");

-- AddForeignKey
ALTER TABLE "TelegramNotifyState" ADD CONSTRAINT "TelegramNotifyState_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;
