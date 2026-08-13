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
