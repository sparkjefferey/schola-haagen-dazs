"use client";

import { useEffect, useState, useTransition } from "react";
import { claimDailyCoinAction } from "@/lib/actions";
import { coinReasonText, COIN_CHANGED_EVENT } from "@/lib/coin-errors";

/**
 * 顶栏钱囊：墨银余额 + 每日领取。
 *
 * 余额用本地 state 维护、拿 Server Action 的返回值直接改写——**不靠 revalidatePath
 * 重渲染**（那会在用户正读到一半的长文页上整页闪一下；阅读量自增当初就是为此改走
 * Route Handler 的，见 lib/actions.ts 的说明）。软导航到别的页面时，服务端会重新
 * 渲染 layout，自然带上最新余额。
 *
 * 投币按钮在论文页那边花钱，用一条自定义事件知会这里，免得顶栏数字与页面数字打架。
 */
export default function CoinPurse({
  initialBalance,
  initialClaimable,
  daily,
  tipCap,
}: {
  initialBalance: number;
  initialClaimable: boolean;
  daily: number;
  tipCap: number;
}) {
  const [balance, setBalance] = useState(initialBalance);
  const [claimable, setClaimable] = useState(initialClaimable);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const b = (ev as CustomEvent<{ balance?: number }>).detail?.balance;
      if (typeof b === "number") setBalance(b);
    };
    window.addEventListener(COIN_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COIN_CHANGED_EVENT, onChanged);
  }, []);

  // 成功提示自己退场；失败提示留着，好让学者看清为什么没成
  useEffect(() => {
    if (!msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  function claim() {
    if (pending) return;
    setMsg(null);
    start(async () => {
      const r = await claimDailyCoinAction();
      setBalance(r.balance);
      if (r.ok) {
        setClaimable(false);
        setMsg({ text: `+${daily}`, ok: true });
      } else {
        // 服务端说今日已领（比如另开了一页领过），本地也要跟上
        if (r.reason === "already") setClaimable(false);
        setMsg({ text: coinReasonText(r.reason, tipCap), ok: false });
      }
    });
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 10 }}>
      <span
        title="墨银 · 每日可领，投给优质论著"
        data-testid="coin-balance"
        style={{
          fontFamily: "var(--display)",
          fontSize: 15,
          fontWeight: 700,
          color: "var(--gold-deep)",
          letterSpacing: "0.02em",
        }}
      >
        {balance}
      </span>
      <span style={{ fontSize: 12, color: "var(--ink-soft)", letterSpacing: "0.12em" }}>墨银</span>
      {claimable && (
        <button
          type="button"
          className="btn btn-sm btn-gold"
          data-testid="coin-claim"
          onClick={claim}
          disabled={pending}
          style={{ padding: "2px 10px", fontSize: 13 }}
        >
          {pending ? "领取中" : "领取"}
        </button>
      )}
      {/* 提示刻意独立渲染，不挂在按钮的 else 分支上：领币失败（如入馆未满一日）时
          按钮仍在原处，若把提示塞进 else 就永远没机会露面——按钮照旧、人也照旧不知道为什么。 */}
      {msg && (
        <span
          style={{
            fontSize: 12,
            color: msg.ok ? "var(--gold-deep)" : "var(--maroon-deep)",
          }}
        >
          {msg.text}
        </span>
      )}
    </span>
  );
}
