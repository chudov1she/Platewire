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
import { useAuth } from "@/hooks/useAuth";
import {
  applyAgentProposal,
  clearAgentChat,
  loadAgentChatHistory,
  loadAgentProposals,
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

  const pendingCount = proposals.filter((p) => p.status === "proposed").length;

  async function reload() {
    setError(null);
    const [history, proposalRows] = await Promise.all([
      loadAgentChatHistory(),
      loadAgentProposals(),
    ]);
    setMessages(history);
    setProposals(proposalRows);
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
      await applyAgentProposal(id);
      toast.success(copy.common.apply);
      await reload();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Apply failed";
      setError(message);
      toast.error(message);
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
        <TabsList className="h-9 w-full max-w-md shrink-0 sm:w-fit">
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
            onApply={(id) => void handleApply(id)}
            onReject={(id) => void handleReject(id)}
            proposals={proposals}
          />
        </TabsContent>
      </Tabs>
    </section>
  );
}
