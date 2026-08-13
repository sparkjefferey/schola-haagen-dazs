"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function MessageBell() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchCount = async () => {
      try {
        const res = await fetch("/api/messages/unread", { cache: "no-store" });
        const data = await res.json();
        if (active) setCount(Number(data.count) || 0);
      } catch {
        /* 静默失败，下次轮询再试 */
      }
    };
    fetchCount();
    const timer = setInterval(fetchCount, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <Link href="/messages" className="nitem msg-bell" aria-label="讯息">
      讯息
      {count > 0 && <span className="msg-badge">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
