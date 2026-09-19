"use client";

import { useEffect } from "react";

/**
 * 输入法 Enter 护栏
 * ---------------------------------------------------------------
 * 中文/日文输入法里 Enter 常是「上屏」键：敲英文字母时输入法仍把它当组字，
 * 按 Enter 才把字母落到输入框。这一下若被当成「发送/提交」，半截话就出去了。
 *
 * 要拦的其实是三件事，缺一不可：
 * 1. 组字进行中：事件带 isComposing；部分输入法不标它，只标 keyCode 229。
 *    这一击归输入法处置，**连 preventDefault 都不要碰**（碰了会打断组字）。
 * 2. 刚上屏的余波：Safari 确认候选时先派发 compositionend、后派发 keydown，
 *    等 keydown 到手 isComposing 已是 false —— 只能靠时间窗兜住这一击。
 *    这一击要吞掉（preventDefault），否则还会在框里多落一个换行、或把表单提交出去。
 * 3. 其余 Enter 一律放行。
 *
 * 护栏挂在 document 捕获阶段，站内所有 input/textarea（登录、注册、检索……）
 * 都吃这一层，不必逐个改；聊天框另有本地判断（见 chat-panel.tsx），双保险。
 */

/** 上屏余波窗口。Safari 的 compositionend → keydown 间隔在 1ms 量级，100ms 足够宽容；
 *  代价只是「上屏后立刻再按一次 Enter」被吞掉一下，再按一下即发 ——
 *  比起把半截话发出去，这个代价小得多。 */
const COMMIT_ECHO_MS = 100;

let lastCompositionEndAt = 0;

/** 取原生事件：护栏两处入口，一处是 React 合成事件，一处是 document 原生监听。 */
function nativeOf(e: KeyboardEvent | React.KeyboardEvent): KeyboardEvent {
  return (e as React.KeyboardEvent).nativeEvent ?? (e as KeyboardEvent);
}

/** 这一击正被输入法占着（组字中）。调用方应原样放过，不要动默认行为。 */
export function imeOwnsKey(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const native = nativeOf(e);
  return native.isComposing === true || native.keyCode === 229;
}

/** 上屏余波：compositionend 刚发生过，这一击多半就是「确认候选」那一下。 */
export function compositionJustEnded(): boolean {
  return Date.now() - lastCompositionEndAt < COMMIT_ECHO_MS;
}

/** 空组件：只负责把护栏挂到 document 上（见 app/layout.tsx）。 */
export function ImeEnterGuard() {
  useEffect(() => {
    const onCompositionEnd = () => {
      lastCompositionEndAt = Date.now();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      // 只管文本输入处；按钮上按 Enter（如确认对话框）不归护栏管
      if (tag !== "INPUT" && tag !== "TEXTAREA") return;
      if (imeOwnsKey(e)) return;
      if (compositionJustEnded()) e.preventDefault();
    };
    document.addEventListener("compositionend", onCompositionEnd, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("compositionend", onCompositionEnd, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
  return null;
}
