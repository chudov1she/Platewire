"use client";

import { AppChrome } from "@/components/layout/AppChrome";
import { AuthGate } from "@/hooks/useAuth";

export default function AppSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate>
      <AppChrome>{children}</AppChrome>
    </AuthGate>
  );
}
