"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Bot, User } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";
import type { NestAgentChatMessage } from "@/types";

const markdownClassName = cn(
  "break-words text-sm leading-relaxed",
  "[&>:first-child]:mt-0 [&>:last-child]:mb-0",
  "[&_p]:my-2 [&_p]:whitespace-pre-wrap",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_em]:italic",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5",
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5",
  "[&_li]:leading-relaxed",
  "[&_a]:text-emerald-400 [&_a]:underline [&_a]:underline-offset-2",
  "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-2.5",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_h1]:mb-2 [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mb-1.5 [&_h3]:mt-2.5 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_hr]:my-3 [&_hr]:border-border",
  "[&_th]:border [&_th]:border-border [&_th]:bg-muted/40 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5",
  "[&_tr:nth-child(even)_td]:bg-muted/15"
);

export function AgentMessageBubble({ message }: { message: NestAgentChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex max-w-[min(100%,42rem)] gap-2.5",
        isUser ? "ml-auto flex-row-reverse" : "mr-auto"
      )}
    >
      <Avatar className="mt-0.5" size="sm">
        <AvatarFallback
          className={cn(
            isUser
              ? "bg-emerald-500/20 text-emerald-400"
              : "bg-muted text-muted-foreground"
          )}
        >
          {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
        </AvatarFallback>
      </Avatar>

      <div
        className={cn(
          "min-w-0 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-emerald-500/15 text-foreground"
            : "border border-border/80 bg-card text-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <div className={markdownClassName}>
            <ReactMarkdown
              components={{
                a: ({ href, children }) => (
                  <a href={href} rel="noreferrer" target="_blank">
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="my-3 overflow-x-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-left text-sm">{children}</table>
                  </div>
                ),
              }}
              remarkPlugins={[remarkGfm]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        {message.toolsUsed?.length ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {copy.agent.toolsUsed}
            </span>
            {message.toolsUsed.map((tool) => (
              <Badge className="rounded-md font-mono text-[10px]" key={tool} variant="secondary">
                {tool}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
