/**
 * 墨银操作的失败文案。
 *
 * **刻意做成零依赖的纯模块**：`lib/coins.ts` 引了 better-sqlite3（原生模块，进了
 * 客户端打包会炸），而顶栏钱囊、投币按钮都是客户端组件、都要显示这些提示，
 * 所以文案不能留在 coins.ts 里。与 `lib/register-errors.ts` 同一套办法。
 */
export function coinReasonText(reason: string, tipCap = 3): string {
  switch (reason) {
    case "inactive":
      return "此账号当前不可用。";
    case "too_young":
      return "入馆未满一日，明日再来领受。";
    case "already":
      return "今日已领过了，明日再来。";
    case "gone":
      return "此稿已不存。";
    case "unpublished":
      return "未刊之稿不可投币——先等它刊印成典。";
    case "self":
      return "自己的论著不可自投。";
    case "capped":
      return `同一篇论著至多投 ${tipCap} 枚。`;
    case "poor":
      return "钱囊空了，先去领取今日的墨银。";
    default:
      return "操作未成，请稍后再试。";
  }
}

/** 投币成功后广播给全站（顶栏钱囊监听它即时更新余额）。 */
export const COIN_CHANGED_EVENT = "schola:coins-changed";
