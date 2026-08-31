#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 登录问题诊断脚本（只读，默认不改任何数据）
#  用途：查清「管理员密码突然登不上」的根因。
#
#  用法（在服务器项目目录里）：
#      cd /opt/schola-haagen-dazs
#      git pull
#      bash scripts/diagnose-login.sh            # 纯诊断，只读
#      bash scripts/diagnose-login.sh --unlock   # 诊断 + 清空登录失败计数（解锁）
#
#  输出已脱敏：不打印完整口令哈希，只打印盐的前 8 位用于「是否同一个库」的比对。
# ============================================================
set -u

UNLOCK=0
[ "${1:-}" = "--unlock" ] && UNLOCK=1

echo "=========== 沙藏学馆 · 登录诊断 ==========="
echo "执行时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo ""

echo "=== A. 主机与容器 ==="
echo "hostname: $(hostname)"
echo "uptime:   $(uptime -p 2>/dev/null || uptime)"
docker ps -a --filter name=schola --format '容器状态={{.Status}}' 2>&1
docker inspect schola-haagen-dazs --format '启动于={{.State.StartedAt}}  重启次数={{.RestartCount}}' 2>&1
docker inspect schola-haagen-dazs --format '卷挂载={{range .Mounts}}{{.Name}} -> {{.Destination}} {{end}}' 2>&1
echo ""

echo "=== B. 数据库文件（持久化卷内）==="
VOL=$(docker volume inspect schola-data --format '{{.Mountpoint}}' 2>/dev/null)
echo "卷实际路径: ${VOL:-未找到 schola-data 卷（严重！数据可能不在持久卷里）}"
if [ -n "$VOL" ]; then
  ls -la "$VOL" 2>&1 | head -10
fi
echo ""

echo "=== C. 用户表（脱敏：哈希只取前 8 位盐前缀）==="
docker exec schola-haagen-dazs node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
const total = db.prepare("select count(*) c from users").get().c;
console.log("用户总数:", total);
const rows = db.prepare("select id,username,display_name,role,root,status,created_at,length(password_hash) hl,substr(password_hash,1,8) hp from users order by id").all();
for (const r of rows) {
  console.log(`#${r.id}  ${r.username}  名:${r.display_name}  role:${r.role}  root:${r.root}  状态:${r.status}  建于:${r.created_at}  哈希长:${r.hl}  盐前缀:${r.hp}`);
}
db.close();
' 2>&1 | head -40
echo ""

echo "=== D. 登录失败计数（被限流锁住会表现为“密码不对”）==="
docker exec schola-haagen-dazs node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
try {
  const rows = db.prepare("select ip,username,count,window_end from login_attempts order by window_end desc limit 20").all();
  console.log("当前被记的失败条目:", rows.length);
  for (const r of rows) console.log(`  ip=${r.ip}  用户=${r.username}  失败${r.count}次  窗口至 ${r.window_end}`);
} catch (e) { console.log("读取失败:", e.message); }
db.close();
' 2>&1 | head -30
echo ""

echo "=== E. 最近审计日志（看口令/权限是否被改过）==="
docker exec schola-haagen-dazs node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
try {
  const rows = db.prepare("select id,actor_id,action,target,created_at from audit_log order by id desc limit 25").all();
  for (const r of rows) console.log(`  #${r.id} ${r.created_at} actor=${r.actor_id} ${r.action} -> ${r.target}`);
} catch (e) { console.log("读取失败:", e.message); }
db.close();
' 2>&1 | head -35
echo ""

echo "=== F. 现存会话 ==="
docker exec schola-haagen-dazs node -e '
const Database = require("better-sqlite3");
const db = new Database("/app/data/schola.db", { readonly: true });
try {
  const rows = db.prepare("select s.user_id,u.username,s.expires_at from sessions s join users u on u.id=s.user_id order by s.expires_at desc limit 15").all();
  console.log("有效会话数:", rows.length);
  for (const r of rows) console.log(`  user#${r.user_id} ${r.username} 过期于 ${r.expires_at}`);
} catch (e) { console.log("读取失败:", e.message); }
db.close();
' 2>&1 | head -25
echo ""

echo "=== G. 线上版本与历史备份 ==="
cat /opt/schola-haagen-dazs/public/version.json 2>&1
echo "--- 备份文件（按时间倒序，最多 8 个）---"
ls -lat /opt/schola-haagen-dazs/backups/*.sqlite 2>/dev/null | head -8 || echo "  未找到 .sqlite 备份"
echo ""

echo "=== H. 入口状态（不打印公网地址）==="
systemctl is-active cloudflared 2>/dev/null || echo "  cloudflared: 非 systemd 托管"
if pgrep -x cloudflared >/dev/null 2>&1; then echo "  cloudflared 进程: 在跑"; else echo "  cloudflared 进程: 未找到（公网入口可能断了）"; fi
curl -s -o /dev/null -w "  本机 127.0.0.1:3000 状态码=%{http_code}\n" --max-time 8 http://127.0.0.1:3000/ 2>&1
echo ""

if [ "$UNLOCK" = "1" ]; then
  echo "=== I. 清理登录失败计数 ==="
  docker exec schola-haagen-dazs node -e '
  const Database = require("better-sqlite3");
  const db = new Database("/app/data/schola.db");
  const n = db.prepare("DELETE FROM login_attempts").run().changes;
  console.log("已清除失败计数条目:", n);
  db.close();
  ' 2>&1
  echo "  （限流记录已清空。若此前是被锁，现在可以再试一次登录。）"
  echo ""
fi

echo "=========== 诊断结束 ==========="
