"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";

/**
 * 顶部「讯息」铃铛。
 * 未读数 = 私聊 + 系统通知 + 论辩回应（见 lib/messages.ts getUnreadCount）。
 *
 * 之所以要盯路由变化：这是客户端组件，页内跳转不会重挂载它，
 * 于是「点开讯息把消息读掉」之后红点仍挂着旧数字，非刷新不可。
 * 现在每次导航（含 /messages 内部 ?with=xxx 的切换）都立刻对一次账，
 * 轮询只作为兜底。
 */
export function MessageBell({ initialCount = 0 }: { initialCount?: number }) {
  const [count, setCount] = useState(initialCount);
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fetchCount = useCallback(async () => {
    try {
      // 带时间戳：绕开浏览器/中间层对 GET 的缓存，确保读到刚写入的已读状态
      const res = await fetch(`/api/messages/unread?t=${Date.now()}`, { cache: "no-store" });
      const data = await res.json();
      setCount(Number(data.count) || 0);
    } catch {
      /* 静默失败，下次轮询再试 */
    }
  }, []);

  // 路由一变就立即对账。真实浏览器返回时 Next 会软导航，
  // 服务端此时已完成「标记已读」，所以这一次拉取拿到的就是读后的新数。
  const routeKey = `${pathname}?${searchParams.toString()}`;
  useEffect(() => {
    fetchCount();
  }, [routeKey, fetchCount]);

  // 兜底：定时轮询 + 切回本标签页时补一次
  useEffect(() => {
    const timer = setInterval(fetchCount, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchCount]);

  return (
    <Link href="/messages" className="nitem msg-bell" aria-label="讯息">
      讯息
      {count > 0 && <span className="msg-badge">{count > 99 ? "99+" : count}</span>}
    </Link>
  );
}
