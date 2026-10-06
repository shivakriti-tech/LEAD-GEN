"use client";

import { useEffect, useRef, useState } from "react";

export type NotifyState = "off" | "on" | "denied" | "unsupported";

/**
 * Lets you leave a running search: its progress shows in the browser tab's title, and when it's
 * done the title says so and (if you asked) a desktop notification tells you, even from another tab.
 */
export function useRunAlerts(running: boolean, progress: string, summary: string): { notify: NotifyState; ask: () => void } {
  const [notify, setNotify] = useState<NotifyState>("off");
  const base = useRef<string | null>(null);
  const was = useRef(false);

  useEffect(() => {
    base.current ??= document.title;
    if (typeof Notification === "undefined") setNotify("unsupported");
    else if (Notification.permission === "denied") setNotify("denied");
  }, []);

  useEffect(() => {
    if (running && base.current !== null) document.title = `${progress} · ${base.current}`;
  }, [running, progress]);

  useEffect(() => {
    const finished = was.current && !running;
    was.current = running;
    if (!finished || base.current === null) return;
    const original = base.current;
    document.title = `✓ ${summary} · ${original}`;
    const away = document.hidden || !document.hasFocus();
    if (notify === "on" && away && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        const n = new Notification("Your lead search is ready", { body: summary, tag: "lead-search" });
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {}
    }
    // the ✓ stays in the tab until you come back to it
    const restore = () => {
      if (document.hidden) return;
      document.title = original;
      document.removeEventListener("visibilitychange", restore);
    };
    if (document.hidden) document.addEventListener("visibilitychange", restore);
    else {
      const t = setTimeout(() => (document.title = original), 10_000);
      return () => clearTimeout(t);
    }
    return () => document.removeEventListener("visibilitychange", restore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const ask = () => {
    if (typeof Notification === "undefined") return setNotify("unsupported");
    if (notify === "on") return setNotify("off");
    if (Notification.permission === "granted") return setNotify("on");
    Notification.requestPermission().then(
      (p) => setNotify(p === "granted" ? "on" : p === "denied" ? "denied" : "off"),
      () => setNotify("denied"),
    );
  };
  return { notify, ask };
}
