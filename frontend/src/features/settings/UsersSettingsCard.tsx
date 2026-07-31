"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NoticeError } from "@/components/ui/feedback";
import { PageLoader } from "@/components/ui/page-loader";
import { ConfirmApplyDialog } from "@/features/settings/ConfirmApplyDialog";
import { createUser, loadUsers, setUserStatus } from "@/lib/api";
import { copy } from "@/lib/copy";
import type { SafeUser } from "@/types";

export function UsersSettingsCard() {
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newLogin, setNewLogin] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [toggleUser, setToggleUser] = useState<SafeUser | null>(null);

  async function reload() {
    setUsers(await loadUsers());
  }

  useEffect(() => {
    reload()
      .catch((err) => setError(err instanceof Error ? err.message : copy.settings.usersLoadFailed))
      .finally(() => setLoading(false));
  }, []);

  async function onConfirmCreate() {
    if (!newLogin.trim() || !newPassword.trim()) return;
    setPending(true);
    try {
      await createUser({ login: newLogin.trim(), password: newPassword.trim(), status: "USER" });
      setNewLogin("");
      setNewPassword("");
      setCreateOpen(false);
      toast.success(copy.settings.userCreated);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.settings.userCreateFailed);
    } finally {
      setPending(false);
    }
  }

  async function onConfirmToggle() {
    if (!toggleUser) return;
    const next = toggleUser.status === "USER" ? "GUEST" : "USER";
    setPending(true);
    try {
      await setUserStatus(toggleUser.id, next);
      setToggleUser(null);
      toast.success(copy.settings.userStatusUpdated);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : copy.settings.userStatusFailed);
    } finally {
      setPending(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-10">
          <PageLoader />
        </CardContent>
      </Card>
    );
  }

  const toggleNext = toggleUser?.status === "USER" ? "GUEST" : "USER";

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.settings.usersTitle}</CardTitle>
        <CardDescription>{copy.settings.usersDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error ? <NoticeError>{error}</NoticeError> : null}
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-40"
            onChange={(e) => setNewLogin(e.target.value)}
            placeholder={copy.settings.loginPlaceholder}
            value={newLogin}
          />
          <Input
            className="w-40"
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={copy.settings.passwordPlaceholder}
            type="password"
            value={newPassword}
          />
          <Button
            disabled={!newLogin.trim() || !newPassword.trim()}
            onClick={() => setCreateOpen(true)}
            type="button"
            variant="outline"
          >
            {copy.settings.createUser}
          </Button>
        </div>
        <div className="grid gap-1">
          {users.map((u) => (
            <div
              className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
              key={u.id}
            >
              <div>
                <span className="font-medium">
                  {u.displayName ?? u.login ?? u.telegramUsername ?? u.id}
                </span>
                <Badge className="ml-2" variant="outline">
                  {u.status}
                </Badge>
              </div>
              {u.status !== "ADMIN" ? (
                <Button onClick={() => setToggleUser(u)} size="sm" type="button" variant="outline">
                  {u.status === "USER" ? copy.settings.blockUser : copy.settings.unblockUser}
                </Button>
              ) : null}
            </div>
          ))}
        </div>

        <ConfirmApplyDialog
          confirmLabel={copy.settings.createUser}
          description={
            <>
              Будет создан пользователь{" "}
              <span className="font-medium text-foreground">{newLogin.trim()}</span> со статусом USER.
            </>
          }
          onConfirm={onConfirmCreate}
          onOpenChange={setCreateOpen}
          open={createOpen}
          pending={pending}
          title={copy.settings.confirmCreateUserTitle}
        />

        <ConfirmApplyDialog
          confirmLabel={
            toggleUser?.status === "USER" ? copy.settings.blockUser : copy.settings.unblockUser
          }
          description={
            toggleUser ? (
              <>
                Статус{" "}
                <span className="font-medium text-foreground">
                  {toggleUser.displayName ?? toggleUser.login ?? toggleUser.id}
                </span>
                : {toggleUser.status} → {toggleNext}.
              </>
            ) : (
              "—"
            )
          }
          destructive={toggleUser?.status === "USER"}
          onConfirm={onConfirmToggle}
          onOpenChange={(open) => {
            if (!open) setToggleUser(null);
          }}
          open={Boolean(toggleUser)}
          pending={pending}
          title={copy.settings.confirmToggleUserTitle}
        />
      </CardContent>
    </Card>
  );
}
