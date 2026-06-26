"use client";

/**
 * InboxUnreadBadge.tsx — small unread count pill for the SideNav Inbox item.
 *
 * Inputs:  none (fetches GET /api/inbox/unread-count)
 * Outputs: a pill with the unread count; hidden when zero. Polls every 60s and
 *          refreshes when the tab regains focus.
 * Used by: SideNav.
 */

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";

export function InboxUnreadBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetchJson<{ count: number }>("/api/inbox/unread-count");
      if (alive && res.success) setCount(res.data.count);
    };
    void load();
    const id = setInterval(load, 60_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-action px-1.5 py-0.5 text-[10px] font-bold leading-none text-white mono-num">
      {count > 99 ? "99+" : count}
    </span>
  );
}
