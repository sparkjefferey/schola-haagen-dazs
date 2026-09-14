/**
 * 雅名（用户名）的规则与取名建议。
 * 这里只有纯逻辑、不碰数据库 —— 客户端与服务端共用同一份规则，
 * 免得出现"前端说行、后端说不行"的两套标准。
 */

export const USERNAME_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{2,20}$/;
export const USERNAME_MAX = 20;

export function normalizeUsername(raw: string): string {
  return raw.trim();
}

/** 返回第一处不合规的说明；合规则返回 null。文案与注册页红字一致。 */
export function usernameProblem(raw: string): string | null {
  const name = normalizeUsername(raw);
  if (!name) return "这一栏还没填：请写上你的雅名。";
  if (name.length < 2) return "雅名太短，至少 2 位。";
  if (name.length > USERNAME_MAX) return "雅名太长，最多 20 位。";
  if (!USERNAME_RE.test(name)) return "雅名只能用字母、数字、下划线或汉字，且首尾不能有空格。";
  return null;
}

/**
 * 撞名时的备选：在本名后加年份/短年份，逐个交给 isFree 试出可用的。
 * 只做"像人取的名"，不生成乱码串，免得注册出一堆机器味账号。
 */
export function suggestUsernames(
  base: string,
  isFree: (name: string) => boolean,
  want = 2,
): string[] {
  const name = normalizeUsername(base);
  if (!name) return [];
  const year = String(new Date().getFullYear());
  const stem = name.length > USERNAME_MAX - year.length ? name.slice(0, USERNAME_MAX - year.length) : name;
  const out: string[] = [];
  for (const candidate of [`${stem}${year}`, `${stem}_${year}`, `${stem}${year.slice(2)}`, `${stem}_${year.slice(2)}`]) {
    if (out.length >= want) break;
    if (candidate === name) continue;
    if (out.includes(candidate)) continue;
    if (candidate.length > USERNAME_MAX || !USERNAME_RE.test(candidate)) continue;
    if (!isFree(candidate)) continue;
    out.push(candidate);
  }
  return out;
}
