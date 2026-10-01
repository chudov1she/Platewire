-- Collector-only schema: drop desk/agent tables and allow many odds snapshots per stage.

DROP TABLE IF EXISTS "AgentProposal";
DROP TABLE IF EXISTS "FormulaProduction";
DROP TABLE IF EXISTS "F5LedgerEntry";
DROP TABLE IF EXISTS "AiDecisionTrace";
DROP TABLE IF EXISTS "FormulaVersion";
DROP TABLE IF EXISTS "TelegramNotifyState";
DROP TABLE IF EXISTS "AgentChatMessage";

DROP INDEX IF EXISTS "F5OddsSnapshot_gameId_stage_key";

CREATE INDEX IF NOT EXISTS "F5OddsSnapshot_gameId_stage_fetchedAt_idx"
  ON "F5OddsSnapshot"("gameId", "stage", "fetchedAt");
