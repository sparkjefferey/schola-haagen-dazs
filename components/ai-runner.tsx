"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 学正（AI）点评的执行小件。
 *
 * 页面渲染出「正在思索」气泡后，由本件发一次 POST /api/ai/run 把任务领起来 ——
 * 模型调用慢（20–40 秒），不能压在表单提交里让人干等。做完 router.refresh()，
 * 那条 AI 回复就上屏了。
 *
 * 多种情形要分开对待，否则会刷成环：
 *   - 本次是我们跑完的 → 刷新，收工；
 *   - 别人正在跑（skipped + running）→ 隔几秒再看一眼，直到出结果（多标签页同时开着是常态）；
 *   - 已完成 / 被拒 / 任务已消失 → 刷新一次看结果，收工。
 *
 * ⚠️ 「是否已卸载」只能用**只跑一次的 effect** 来记（见下面 mounted）：
 * 若写成 `useEffect(..., [callId, router])` 里的局部 `alive`，组件重渲染会让该 effect
 * 重跑并跑一次 cleanup，于是**正在飞的请求回来时被误判成「已卸载」**，收尾刷新就丢了
 * —— 表现是「服务端答了、库里也写了，页面却没更新」，极难查（本件第一版正是栽在这里）。
 */
export default function AiRunner({ callId }: { callId: number }) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const fired = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 只在真正卸载时置 false（deps 为空，不会因重渲染而重跑）。
  // 函数体里那句 `= true` 不能省：开发模式下 React StrictMode 会把 effect
  // 「卸载再挂载」跑一遍，cleanup 会先把它置成 false，不在这里复位就永远醒不过来。
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (fired.current) return; // 开发模式下 effect 会跑两遍，只认第一遍
    fired.current = true;
    let tries = 0;

    const again = (ms: number) => {
      timer.current = setTimeout(() => void run(), ms);
    };

    const run = async (): Promise<void> => {
      if (!mounted.current) return;
      tries++;
      let data: any = null;
      try {
        const res = await fetch("/api/ai/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call_id: callId }),
        });
        data = await res.json().catch(() => null);
      } catch {
        data = null;
      }
      if (!mounted.current) return;

      if (!data) {
        if (tries <= 3) return again(3000); // 网络抖动，再试几次
        setNote("未能请到学正（网络不通）。刷新页面可再试。");
        return;
      }
      if (data.skipped) {
        if (data.status === "running") {
          if (tries <= 20) return again(4000);
          setNote("学正还在思索，稍后刷新页面可见。");
          return;
        }
        // done / failed / refused / gone：刷新看结果（失败态那边自带重试按钮）
        router.refresh();
        return;
      }
      router.refresh();
    };

    void run();
  }, [callId, router]);

  if (!note) return null;
  return (
    <p className="meta" style={{ marginTop: 8, fontSize: 12.5 }}>
      {note}
    </p>
  );
}
