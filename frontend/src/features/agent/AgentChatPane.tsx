"use client";

import type { FormEvent, KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import { SendHorizonal } from "lucide-react";
import { EmptyState } from "@/components/feedback/EmptyState";
import { AgentMessageBubble } from "@/features/agent/AgentMessageBubble";
import { Button } from "@/components/ui/button";
import { InlineLoader } from "@/components/ui/page-loader";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { copy } from "@/lib/copy";
import type { NestAgentChatMessage } from "@/types";

export function AgentChatPane({
  messages,
  draft,
  sending,
  onDraftChange,
  onSend,
}: {
  messages: NestAgentChatMessage[];
  draft: string;
  sending: boolean;
  onDraftChange: (value: string) => void;
  onSend: (prompt: string) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSend(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend(draft);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4" ref={listRef}>
        <div className="flex flex-col gap-3">
          {!messages.length && !sending ? (
            <EmptyState
              className="border-0 bg-transparent py-10"
              description={copy.agent.description}
              title={copy.agent.title}
            />
          ) : null}

          {messages.map((message) => (
            <AgentMessageBubble key={message.id} message={message} />
          ))}

          {sending ? (
            <div className="mr-auto flex items-center gap-2 rounded-2xl border border-border/80 bg-card px-3.5 py-2.5">
              <InlineLoader label={copy.agent.sending} />
            </div>
          ) : null}
        </div>
      </div>

      <Separator />

      <div className="shrink-0 p-3 sm:p-4">
        <form className="flex items-end gap-2" onSubmit={submit}>
          <Textarea
            className="min-h-11 max-h-28 flex-1 resize-none rounded-xl"
            disabled={sending}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={copy.agent.placeholder}
            rows={2}
            value={draft}
          />
          <Button
            className="h-11 w-11 shrink-0 rounded-xl"
            disabled={sending || !draft.trim()}
            size="icon"
            type="submit"
          >
            <SendHorizonal className="size-4" />
            <span className="sr-only">{sending ? copy.agent.sending : copy.agent.send}</span>
          </Button>
        </form>
      </div>
    </div>
  );
}
