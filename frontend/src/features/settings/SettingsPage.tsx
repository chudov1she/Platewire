"use client";

import { PipelineSettingsCard } from "@/features/settings/PipelineSettingsCard";
import { UsersSettingsCard } from "@/features/settings/UsersSettingsCard";
import { useAuth } from "@/hooks/useAuth";
import { copy } from "@/lib/copy";

export function SettingsPage() {
  const { isAdmin } = useAuth();

  return (
    <section className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{copy.settings.title}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{copy.settings.description}</p>
      </div>

      {isAdmin ? <UsersSettingsCard /> : null}
      {isAdmin ? <PipelineSettingsCard /> : null}
    </section>
  );
}
