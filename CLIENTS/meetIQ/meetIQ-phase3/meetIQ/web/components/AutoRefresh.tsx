"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-fetches the current server component tree on an interval. Used on the
 * dashboard while a lecture is `processing` on the background job queue, so
 * the page catches up to `processed`/`failed` without the person refreshing
 * by hand. Renders nothing; stops polling automatically on unmount (the
 * caller only mounts it while something is actually processing).
 */
export function AutoRefresh({ intervalMs = 4000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
