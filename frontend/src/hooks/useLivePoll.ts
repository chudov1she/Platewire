"use client";

import { useEffect, useRef } from "react";

/**
 * Stable interval poll. Keeps `fn` fresh via ref so the interval is NOT
 * reset when the callback identity changes (unlike putting fn in effect deps).
 * Do not put a 1s clock (`nowMs`) into `enabled` derivation.
 */
export function useLivePoll(
  enabled: boolean,
  fn: () => void | Promise<void>,
  intervalMs: number,
) {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled || intervalMs <= 0) return;
    const timer = window.setInterval(() => {
      void Promise.resolve(fnRef.current()).catch(() => undefined);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, intervalMs]);
}
