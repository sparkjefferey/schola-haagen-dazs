"use client";

import { useEffect, useRef } from "react";

/**
 * 阅读量自增。
 *
 * 走 Route Handler 而不是 Server Action：Server Action 里若调 revalidatePath，
 * Next.js 会重新渲染当前路由，长文页上就会在读者滚到一半时整页闪一下、打断滚动。
 * 这里只发一个「写了就忘」的请求，不触碰任何页面状态。
 */
export default function ViewTally({ paperId }: { paperId: number }) {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    // 写了就忘：失败也不提示——阅读量不是读者该关心的事，更不能因此打断阅读
    void fetch(`/api/papers/${paperId}/view`, { method: "POST" }).catch(() => {});
  }, [paperId]);
  return null;
}
