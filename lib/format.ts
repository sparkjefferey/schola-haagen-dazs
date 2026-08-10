export const FOUNDING = new Date(2024, 5, 6, 0, 0, 0);

export function schoolYear(now = new Date()): number {
  let y = now.getFullYear() - FOUNDING.getFullYear();
  const before = now < new Date(now.getFullYear(), 5, 6);
  if (before) y -= 1;
  return y + 1;
}

export function formatDate(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, "0")}月${String(d.getDate()).padStart(2, "0")}日`;
}

export function formatShort(iso: string): string {
  const d = new Date(iso.endsWith("Z") ? iso : iso + "Z");
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

export function timeAgo(iso: string): string {
  const t = new Date(iso.endsWith("Z") ? iso : iso + "Z").getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "方才";
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(iso);
}

export function initials(name: string): string {
  const s = name.trim();
  if (/^[a-zA-Z]/.test(s)) return s.slice(0, 2).toUpperCase();
  return s.slice(0, 2);
}

export function avatarTone(id: number) {
  return AVATAR_ALIASES[id % AVATAR_ALIASES.length];
}

const AVATAR_ALIASES = [
  ["#b4933f", "#fdf6e3"],
  ["#6d2f2b", "#fdf6e3"],
  ["#2c4a3e", "#fdf6e3"],
  ["#3a3562", "#fdf6e3"],
  ["#8a5a2b", "#fdf6e3"],
  ["#4c4c4c", "#fdf6e3"],
] as const;