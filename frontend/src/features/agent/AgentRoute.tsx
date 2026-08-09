"use client";

import { useEffect, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { AgentChatPane } from "@/features/agent/AgentChatPane";
import { AgentProposalsPane } from "@/features/agent/AgentProposalsPane";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormulaSettingsCard } from "@/features/settings/FormulaSettingsCard";
import { useAuth } from "@/hooks/useAuth";
import {
  applyAgentProposal,
  clearAgentChat,
  loadAgentChatHistory,
  loadAgentProposals,
  loadProductionFormula,
  rejectAgentProposal,
  runAgentCuration,
  sendAgentChatMessage,
} from "@/lib/api";
import { copy } from "@/lib/copy";
import type { NestAgentChatMessage, NestAgentProposal } from "@/types";

export function AgentRoute() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState("chat");
  const [messages, setMessages] = useState<NestAgentChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [proposals, setProposals] = useState<NestAgentProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [curating, setCurating] = useState(false);
  const [productionLabel, setProductionLabel] = useState<string | null>(null);
  const [formulaKey, setFormulaKey] = useState(0);

  const pendingCount = proposals.filter((p) => p.status === "proposed").length;

  async function reloadProduction() {
    try {
      const prod = await loadProductionFormula();
      setProductionLabel(prod.versionLabel);
    } catch {
      /* non-blocking */
    }
  }

  async function reload() {
    setError(null);
    const [history, proposalRows] = await Promise.all([
      loadAgentChatHistory(),
      loadAgentProposals(),
    ]);
    setMessages(history);
    setProposals(proposalRows);
    await reloadProduction();
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) => setError(err instanceof Error ? err.message : copy.agent.loadFailed))
      .finally(() => setLoading(false));
  }, []);

  async function sendPrompt(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || sending) return;
    setDraft("");
    setSending(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${Date.now()}`,
        role: "user",
        content: trimmed,
        toolsUsed: [],
        createdAt: new Date().toISOString(),
      },
    ]);
    try {
      const result = await sendAgentChatMessage(trimmed);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-a`,
          role: "assistant",
          content: result.message,
          toolsUsed: result.toolsUsed,
          createdAt: new Date().toISOString(),
        },
      ]);
      await reload().catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : copy.agent.sendFailed;
      setError(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  }

  async function handleApply(id: string) {
    setActionId(id);
    setError(null);
    try {
      const applied = await applyAgentProposal(id);
      const label = applied.createdVersion?.versionLabel ?? applied.id.slice(0, 8);
      toast.success(`${copy.agent.appliedAs} ${label}`);
      await reload();
      setFormulaKey((k) => k + 1);
      setTab("formula");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      setError(message);
      toast.error(message);
      throw err;
    } finally {
      setActionId(null);
    }
  }

  async function handleReject(id: string) {
    setActionId(id);
    setError(null);
    try {
      await rejectAgentProposal(id);
      toast.success(copy.common.reject);
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Reject failed";
      setError(message);
      toast.error(message);
    } finally {
      setActionId(null);
    }
  }

  async function handleCuration() {
    setCurating(true);
    setError(null);
    try {
      const result = await runAgentCuration();
      toast.success(result.message || "Curation запущена");
      await reload();
      setTab("proposals");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Curation failed";
      setError(message);
      toast.error(message);
    } finally {
      setCurating(false);
    }
  }

  async function handleClear() {
    await clearAgentChat().catch(() => undefined);
    setMessages([]);
  }

  return (
    <section className="flex h-[calc(100dvh-10.5rem)] max-h-[calc(100dvh-10.5rem)] flex-col gap-3 overflow-hidden md:h-[calc(100dvh-7.25rem)] md:max-h-[calc(100dvh-7.25rem)]">
      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{copy.agent.title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{copy.agent.description}</p>
          {productionLabel ? (
            <button
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-border/80 bg-muted/30 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => setTab("formula")}
              type="button"
            >
              <span>{copy.agent.productionNow}</span>
              <span className="font-mono text-foreground">{productionLabel}</span>
            </button>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
            type="button"
          >
            <MoreHorizontal className="size-4" />
            <span className="sr-only">Действия</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem onClick={() => void handleClear()}>Очистить чат</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setTab("formula")}>{copy.agent.formula}</DropdownMenuItem>
            {isAdmin ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={curating} onClick={() => void handleCuration()}>
                  {curating ? "Curation…" : "Запустить curation"}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
        onValueChange={setTab}
        value={tab}
      >
        <TabsList className="h-9 w-full max-w-xl shrink-0 sm:w-fit">
          <TabsTrigger className="px-3" value="chat">
            Чат
          </TabsTrigger>
          <TabsTrigger className="gap-1.5 px-3" value="proposals">
            {copy.agent.proposals}
            {pendingCount > 0 ? (
              <Badge className="h-5 min-w-5 rounded-md px-1.5 text-[10px]" variant="secondary">
                {pendingCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger className="px-3" value="formula">
            {copy.agent.formula}
          </TabsTrigger>
        </TabsList>

        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-hidden:hidden"
          value="chat"
        >
          <AgentChatPane
            draft={draft}
            messages={messages}
            onDraftChange={setDraft}
            onSend={(prompt) => void sendPrompt(prompt)}
            sending={sending}
          />
        </TabsContent>

        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-hidden:hidden"
          value="proposals"
        >
          <AgentProposalsPane
            actionId={actionId}
            error={error}
            isAdmin={isAdmin}
            loading={loading}
            onApply={handleApply}
            onOpenFormula={() => setTab("formula")}
            onReject={(id) => void handleReject(id)}
            productionLabel={productionLabel}
            proposals={proposals}
          />
        </TabsContent>

        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden data-hidden:hidden"
          value="formula"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
            <FormulaSettingsCard embedded key={formulaKey} onProductionChange={reloadProduction} />
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
