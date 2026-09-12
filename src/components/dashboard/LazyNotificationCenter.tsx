"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const NotificationCenter = dynamic(
  () => import("@/components/NotificationCenter").then((module) => module.NotificationCenter),
  { ssr: false },
);

export function LazyNotificationCenter({ sessionReady }: { sessionReady: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const timerId = globalThis.setTimeout(() => setReady(true), 200);
    return () => globalThis.clearTimeout(timerId);
  }, []);
  if (!ready) return <span aria-hidden="true" className="fixed right-3 top-2 z-40 h-10 w-10 rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 md:right-5 md:top-5" />;
  return <NotificationCenter sessionReady={sessionReady} />;
}
