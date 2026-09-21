"use client";

import { useEffect, useState, useTransition } from "react";
import { tipPaperAction } from "@/lib/actions";
import { coinReasonText, COIN_CHANGED_EVENT } from "@/lib/coin-errors";

/**
 * 论著页的投币键。
 *
 * 墨银投出即焚：币不进作者口袋，只把这篇稿的「获币数」+1；作者那边得到的
 * 是实时的「学望」（不可转让、不可消费，仅供荣誉与排序）。所以这里只显示
 * 获币数，不显示「作者收了多少币」——按设计，作者一枚也拿不到。
 *
 * 获奖数与我的投币进度都用本地 state 维护、拿 Server Action 的返回值直接改写，
 * 不走 revalidatePath 重渲染（那会让正在读的长文整页闪，见 lib/actions.ts）。
 * 花钱之后广播一条事件给顶栏钱囊，免得两处数字打架。
 */
export default function TipButton({
  paperId,
  initialTips,
  initialMine,
  tipCap,
  blocked = "",
}: {
  paperId: number;
  initialTips: number;
  initialMine: number;
  tipCap: number;
  /** 非空即不可投币，内容为原因（未登录 / 自己的论著） */
  blocked?: string;
}) {
  const [tips, setTips] = useState(initialTips);
  const [mine, setMine] = useState(initialMine);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!msg?.ok) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  const full = mine >= tipCap;

  function tip() {
    if (pending || blocked || full) return;
    setMsg(null);
    start(async () => {
      const r = await tipPaperAction(paperId);
      if (typeof r.tips === "number") setTips(r.tips);
      if (typeof r.mine === "number") setMine(r.mine);
      if (r.ok) {
        setMsg({ text: "已投，此稿声望见涨。", ok: true });
        window.dispatchEvent(
          new CustomEvent(COIN_CHANGED_EVENT, { detail: { balance: r.balance } }),
        );
      } else {
        setMsg({ text: coinReasonText(r.reason, tipCap), ok: false });
      }
    });
  }

  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 26, textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "center", gap: 8 }}>
        <span
          data-testid="tip-count"
          style={{
            fontFamily: "var(--display)",
            fontSize: 28,
            fontWeight: 700,
            color: "var(--gold-deep)",
          }}
        >
          {tips}
        </span>
        <span style={{ fontSize: 13, color: "var(--ink-soft)", letterSpacing: "0.14em" }}>
          枚墨银
        </span>
      </div>

      <p className="meta" style={{ marginTop: 6, fontSize: 13 }}>
        {tips === 0 ? "尚无人投币——你可以是第一位。" : "投出即焚：币不归作者，只留声望。"}
      </p>

      {blocked ? (
        <p className="meta" style={{ marginTop: 10, fontSize: 13 }}>{blocked}</p>
      ) : (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="btn btn-gold"
            data-testid="tip-btn"
            onClick={tip}
            disabled={pending || full}
          >
            {pending ? "投币中……" : full ? "已 投 满" : "投 1 枚 墨银"}
          </button>
          <span className="meta" style={{ fontSize: 13 }} data-testid="tip-mine">
            你已投 {mine} / {tipCap}
          </span>
        </div>
      )}

      {msg && (
        <p
          style={{
            marginTop: 8,
            fontSize: 13,
            color: msg.ok ? "var(--gold-deep)" : "var(--maroon-deep)",
          }}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
