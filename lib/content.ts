import { db } from "./db";

/**
 * 文宣司 · 可编辑文案注册表
 * ---------------------------------------------------------------
 * 后台「文宣司」标签页会按这里的列表渲染编辑框（中文标签 + 默认值）。
 * 页面用 getContentMap() 一次取出全部文案：库里有就用库里的，
 * 库里没填就回退到这里的 default，保证任何字段留空都不会变空白。
 *
 * 注意：default 必须是纯文本（不含 <b> 等标签），且不要内嵌 {year}
 * 之类的动态值——带内联格式或年份的段落暂留硬编码，后续可升级为
 * Markdown 编辑器再纳入。
 */
export interface ContentKey {
  key: string;
  label: string; // 后台显示的中文标签
  group: string; // 后台分组
  default: string; // 缺省文案（也是页面当前展示的文字）
  multiline: boolean; // 是否多行（段落=true，标题=false）
}

export const CONTENT_KEYS: ContentKey[] = [
  // ===== 首页 =====
  {
    key: "home_quote",
    group: "首页",
    label: "学派引言（英雄区大段）",
    default:
      "Häagen-Dazs（沙氏）学派，由两位好友于初夏之夜立学。此馆为学派同侪论学、刊文、互证的栖身之所——以冰淇淋之甘甜，喻求知之欢愉；以学霸之严谨，立学人之风骨。凡入学派者，皆为同僚学者；凡发一论者，皆为学派之荣光。",
    multiline: true,
  },
  { key: "home_three_title", group: "首页", label: "「学派三义」栏目标题", default: "学派三义", multiline: false },
  { key: "home_court_title", group: "首页", label: "「庭院即报」栏目标题", default: "庭院即报", multiline: false },
  { key: "home_covenant_title", group: "首页", label: "「学派之约」栏目标题", default: "学派之约", multiline: false },

  // ===== 学派志 =====
  { key: "about_why_title", group: "学派志", label: "「立学缘由」标题", default: "立学缘由", multiline: false },
  {
    key: "about_submotto",
    group: "学派志",
    label: "副训",
    default: "兼有副训：「无引不立论，无思不落笔；且尝且议，好友共席。」",
    multiline: true,
  },
  { key: "about_charter_title", group: "学派志", label: "「学派章程」标题", default: "学派章程（初定）", multiline: false },
  { key: "about_two_ranks_title", group: "学派志", label: "「两阶之制」标题", default: "两阶之制", multiline: false },
  { key: "about_disciplines_title", group: "学派志", label: "「分科之制」标题", default: "分科之制", multiline: false },
  {
    key: "about_footer_appeal",
    group: "学派志",
    label: "页脚倡议",
    default: "学派初立，章程可改，门墙常开。若你同好冷食与真理，欢迎入学同食同论。",
    multiline: true,
  },

  // ===== 学派志 · 正文叙述 =====
  {
    key: "about_why_p1",
    group: "学派志",
    label: "立学缘由·名从天降（段落一）",
    default:
      "Schola Häagen-Dazs——沙藏学馆，一名兼收两意：其一，Häagen-Dazs 乃冷食至艺，我们愿学派如同它一般，**用料诚、搅制精、虽冷而甘**；其二，何期末一隅之甘甜，实足以象征求知——入口凉冽，回甘悠长，正如治学，先苦思而后洞明。",
    multiline: true,
  },
  {
    key: "about_why_p2",
    group: "学派志",
    label: "立学缘由·立誓（段落二，{year}为立学年）",
    default:
      "学派由两位好友于 {year} 年夏夜，在结伴啃下一罐共享品之后立誓而成：「既同席而食，必同席而学。」",
    multiline: true,
  },
  { key: "about_motto_la", group: "学派志", label: "校训（拉丁文）", default: "In Lacte, Veritas.", multiline: false },
  { key: "about_motto_cn", group: "学派志", label: "校训（中文）", default: "真理存于乳膏之中", multiline: false },
  {
    key: "about_two_ranks_p",
    group: "学派志",
    label: "两阶之制·说明正文",
    default:
      "学派不设诸多品位，仅两阶：**管理者**与**学者**。注册时自择身份；管理者另有「燕京阁」调度学务，二者皆可发论文、论辩、入榜。",
    multiline: true,
  },
  {
    key: "about_curator_desc",
    group: "学派志",
    label: "管理者·身份说明",
    default:
      "执掌学馆秩序：任免身份、删定过激之语、整理论文库、执掌学榜档案。管理者须经邀请函入学，且学派不可一日无主（至少保留一位管理者）。",
    multiline: true,
  },
  {
    key: "about_scholar_desc",
    group: "学派志",
    label: "学者·身份说明",
    default:
      "馆中自由人：著书立说、议坛纵横、评点他人篇章。学者之荣，全在文本之上；学问之誉，尽在榜中。注册即入学，无任何门费。",
    multiline: true,
  },
  {
    key: "about_disciplines",
    group: "学派志",
    label: "分科之制（每行：学科名|描述，可增删行）",
    default:
      "乳脂哲学|以奶昔、奶油、酸奶之品性，喻形而上学诸命题。\n感官美学|甜、冷、脆、绵——味道如何塑造记忆与情感。\n美食人类学|一勺一勺的社会史：冰淇淋与文明。\n冷藏物理学|晶相、成核、冰点与过冷——冷冻的科学。\n古文钞本|旧时食单、谱牒、笔记的校勘与考释。\n学派史|本学派自建学以来的档案与传说。",
    multiline: true,
  },

  // ===== 论坛 =====
  { key: "forum_title", group: "论坛", label: "页面标题", default: "学术论坛", multiline: false },
  {
    key: "forum_intro",
    group: "论坛",
    label: "导语",
    default: "以言立学，以辨明理——诸子百家，尽可在门下争鸣。",
    multiline: true,
  },
];

function rowMap(): Map<string, string> {
  const rows = db.prepare("SELECT key, value FROM site_content").all() as any[];
  const m = new Map<string, string>();
  for (const r of rows) if (r.value !== "") m.set(r.key, r.value);
  return m;
}

/** 取出全部文案：库值优先，缺省回退 default。返回 key→文案 的映射。 */
export function getContentMap(): Record<string, string> {
  const store = rowMap();
  const out: Record<string, string> = {};
  for (const k of CONTENT_KEYS) {
    out[k.key] = store.has(k.key) ? store.get(k.key)! : k.default;
  }
  return out;
}

/** 取单条文案（同上，回退 default）。偶发使用。 */
export function getContent(key: string): string {
  const store = rowMap();
  if (store.has(key)) return store.get(key)!;
  return CONTENT_KEYS.find((k) => k.key === key)?.default ?? "";
}
