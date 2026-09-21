import { db } from "./db";

/**
 * 墨银 —— 馆内学者的每日津贴，以及投向论著的票。
 *
 * 三条不可动摇的设计（理由见项目档案）：
 *
 * 1. **投出即焚**：币离开投币者后不进任何人的口袋，只累加论著的「获币数」。
 *    否则熟人之间对投即可互相刷分——学馆只有几十号人、全是熟脸，根本挡不住。
 * 2. **作者得名不得币**：作者拿到的是「学望」，即由其论著获币数实时汇总的成就点。
 *    不可转让、不可消费、只涨不跌，用于荣誉与排序，故永不贬值、也无套现动机。
 * 3. **一切由数据库兜底**：每日一次靠唯一索引，余额不为负靠条件更新。
 *    前端的禁用按钮只是礼貌，不是防线。
 *
 * 轻量化：全功能只用一张 coin_ledger 表 + 两个冗余计数列，学望实时 SUM 得出、
 * 不落库——全站论著只有几十篇，这个量级下即时计算远便宜于维护一致性。
 */

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/** 每日可领墨银 */
export const COIN_DAILY = envInt("COIN_DAILY", 5);
/** 同一人对同一篇论著的投币上限 */
export const COIN_TIP_PER_PAPER = envInt("COIN_TIP_PER_PAPER", 3);
/** 每枚墨银在学绩分中的权重（一枚顶几次阅览） */
export const COIN_SCORE_WEIGHT = envInt("COIN_SCORE_WEIGHT", 5);

const DAY_MS = 24 * 3600_000;

/**
 * 东八区「今天」（YYYY-MM-DD）。
 *
 * 刻意不用 Intl / toLocaleDateString：线上是 alpine 镜像的 Node，可能是 small-icu，
 * 缺 en-CA 这类 locale 时会**静默回落**成 en-US，产出 "09/21/2026" 这种串——唯一
 * 索引照样能拦住重复领取，但 day 字段会烂成一团、日后无从审计。东八区无夏令时
 * （恒定 UTC+8），直接加 8 小时取 UTC 日期即可，零依赖、零 locale 风险。
 */
export function todayShanghai(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function accountAgeMs(createdAt: string): number {
  const t = new Date(createdAt.endsWith("Z") ? createdAt : `${createdAt}Z`).getTime();
  return Number.isFinite(t) ? Math.max(0, Date.now() - t) : 0;
}

export type CoinReason =
  | ""
  | "inactive"
  | "too_young"
  | "already"
  | "gone"
  | "unpublished"
  | "self"
  | "capped"
  | "poor";

export interface CoinResult {
  ok: boolean;
  reason: CoinReason;
  /** 操作后的余额 */
  balance: number;
  /** 该论著获币数（仅投币时带出） */
  tips?: number;
  /** 我在此稿已投枚数（仅投币时带出） */
  mine?: number;
}

/** 领币与投币共用的准入检查（活跃 + 入馆满一日）。 */
function gate(user: { id: number; status: string; created_at: string }): CoinReason {
  if (user.status !== "active") return "inactive";
  // 入馆未满一日不得领币投币：这是挡小号的最低成本手段——注册当天就能刷，
  // 门槛等于零；等满一天，刷号的耐心成本就已高过收益。与投稿冷静期同一套道理。
  if (accountAgeMs(user.created_at) < DAY_MS) return "too_young";
  return "";
}

export function coinBalance(userId: number): number {
  const row = db.prepare("SELECT coin_balance FROM users WHERE id = ?").get(userId) as
    | { coin_balance: number }
    | undefined;
  return row?.coin_balance ?? 0;
}

/** 某人今日是否已领过 */
export function claimedToday(userId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM coin_ledger WHERE user_id = ? AND kind = 'daily' AND day = ?")
    .get(userId, todayShanghai());
}

/** 我在某篇论著上已投几枚 */
export function myTipsOn(userId: number, paperId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(-amount), 0) AS n FROM coin_ledger
       WHERE user_id = ? AND paper_id = ? AND kind = 'tip'`,
    )
    .get(userId, paperId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * 学望：作者已刊论著获币数之和。
 * 实时汇总而非存列——论著只有几十篇，这个查询走 idx_papers_author 即刻返回，
 * 换来的好处是永远不会与账本对不上。
 */
export function getRenown(userId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(tips), 0) AS n FROM papers
       WHERE author_id = ? AND status = 'published'`,
    )
    .get(userId) as { n: number } | undefined;
  return row?.n ?? 0;
}

/**
 * 每日领取。同一天重复调用由唯一索引拦下，返回 reason='already'。
 *
 * 不用「先查再写」：并发两次请求时两次查询都会说「还没领」，然后双双写入。
 * 让 INSERT 去撞唯一索引，撞到就是已领——这是唯一可靠的做法。
 */
export function claimDaily(user: { id: number; status: string; created_at: string }): CoinResult {
  const bad = gate(user);
  if (bad) return { ok: false, reason: bad, balance: coinBalance(user.id) };
  const day = todayShanghai();

  const tx = db.transaction((): CoinResult => {
    try {
      db.prepare(
        "INSERT INTO coin_ledger (user_id, kind, amount, day) VALUES (?, 'daily', ?, ?)",
      ).run(user.id, COIN_DAILY, day);
    } catch (e: any) {
      if (/UNIQUE|constraint/i.test(e?.message ?? "")) {
        return { ok: false, reason: "already", balance: coinBalance(user.id) };
      }
      throw e;
    }
    db.prepare("UPDATE users SET coin_balance = coin_balance + ? WHERE id = ?").run(
      COIN_DAILY,
      user.id,
    );
    return { ok: true, reason: "", balance: coinBalance(user.id) };
  });

  return tx();
}

/**
 * 投一枚墨银给某篇论著。币被销毁，论著获币数 +1，作者学望随之 +1（实时派生）。
 *
 * 自投、未刊、超上限、余额不足全部在事务内判定；余额扣减用条件更新
 * （`WHERE coin_balance >= 1`）而非「先读后写」，changes=0 即余额不足——
 * 这样即使有并发也绝不可能扣成负数。
 */
export function tipPaper(
  user: { id: number; status: string; created_at: string },
  paperId: number,
): CoinResult {
  const bad = gate(user);
  if (bad) return { ok: false, reason: bad, balance: coinBalance(user.id) };

  const tx = db.transaction((): CoinResult => {
    const paper = db
      .prepare("SELECT id, author_id, status, tips FROM papers WHERE id = ?")
      .get(paperId) as
      | { id: number; author_id: number; status: string; tips: number }
      | undefined;
    if (!paper) return { ok: false, reason: "gone", balance: coinBalance(user.id) };
    // 只投已刊之作：未刊之稿尚在审中，投币会变成对审稿结果的干扰
    if (paper.status !== "published") {
      return { ok: false, reason: "unpublished", balance: coinBalance(user.id) };
    }
    // 自投无意义（币焚毁后作者本就不落币），但会虚增获币数，故明令禁止
    if (paper.author_id === user.id) {
      return { ok: false, reason: "self", balance: coinBalance(user.id) };
    }

    const mine = myTipsOn(user.id, paperId);
    if (mine >= COIN_TIP_PER_PAPER) {
      return { ok: false, reason: "capped", balance: coinBalance(user.id), tips: paper.tips, mine };
    }

    const paid = db
      .prepare("UPDATE users SET coin_balance = coin_balance - 1 WHERE id = ? AND coin_balance >= 1")
      .run(user.id);
    if (paid.changes === 0) {
      return { ok: false, reason: "poor", balance: coinBalance(user.id) };
    }

    db.prepare(
      "INSERT INTO coin_ledger (user_id, kind, amount, paper_id) VALUES (?, 'tip', -1, ?)",
    ).run(user.id, paperId);
    db.prepare("UPDATE papers SET tips = tips + 1 WHERE id = ?").run(paperId);

    return {
      ok: true,
      reason: "",
      balance: coinBalance(user.id),
      tips: paper.tips + 1,
      mine: mine + 1,
    };
  });

  return tx();
}

/** 失败原因的文案见 `lib/coin-errors.ts`（那里是零依赖模块，客户端也要用）。 */
