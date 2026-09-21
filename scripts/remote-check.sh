#!/usr/bin/env bash
# 服务器只读体检脚本。
# 用法（由 GitHub Actions 通过 ssh 'bash -s' 喂进来执行，本地不要直接跑）：
#   ssh root@HOST 'bash -s' < scripts/remote-check.sh
# 只做读取与展示，不修改服务器任何状态。

echo "=== 服务器只读体检 $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
echo "hostname: $(hostname)"
echo "uptime:   $(uptime -p 2>/dev/null || uptime)"
echo

echo "--- docker 容器(含已停止) ---"
docker ps -a --format "table {{.Names}}\t{{.Status}}" 2>&1 | head -10
echo

echo "--- 授权公钥审计 ---"
echo "总行数: $(wc -l < ~/.ssh/authorized_keys 2>/dev/null)"
echo "各钥匙指纹:"
ssh-keygen -lf ~/.ssh/authorized_keys 2>&1 | awk '{print $2, $3}' | sort | uniq -c | sort -rn
echo "已知攻击公钥残留数(必须为 0):"
grep -c "ERLxCN6MRokchXQNQPJhN8TsInhv56xYmRUdr7VpDM9" ~/.ssh/authorized_keys 2>/dev/null || echo 0
echo

echo "--- cloudflared 隧道 ---"
CPID=$(pgrep -f "cloudflared tunnel --url" | head -1)
echo "PID=${CPID:-未找到}"
if [ -n "$CPID" ]; then
  echo "输出重定向目标:"
  ls -l "/proc/$CPID/fd/1" "/proc/$CPID/fd/2" 2>&1 | sed 's/.*-> //'
  echo "启动命令行:"
  tr '\0' ' ' < "/proc/$CPID/cmdline" 2>/dev/null
  echo
fi
echo "扫描日志中的隧道地址:"
for f in /root/nohup.out /root/cloudflared.log /var/log/cloudflared.log /tmp/cloudflared.log; do
  if [ -f "$f" ]; then
    echo "-- $f --"
    grep -oE "https://[a-zA-Z0-9._-]+\.trycloudflare\.com" "$f" 2>/dev/null | tail -2
  fi
done
echo "root 家目录:"
ls -la /root/ 2>&1 | head -15
echo

echo "--- 站点健康 ---"
curl -s -o /dev/null -w "本地 3000 端口 HTTP=%{http_code}\n" --max-time 10 http://127.0.0.1:3000/ 2>&1
echo "线上版本:"
cat /opt/schola-haagen-dazs/public/version.json 2>&1
echo

echo "--- 数据库迁移是否落地（只读，容器内查） ---"
# 数据在 schola-data 卷里，宿主机没有 db 文件，故走容器内的 node + better-sqlite3。
# 用途：部署后确认 initSchema 的迁移真的跑了（曾有过「代码上了、列没补」的先例）。
# 两条注意：①要先进项目目录（本脚本经 ssh 'bash -s' 喂进来执行，起点是家目录）；
# ②凡是可能去读 stdin 的命令都要写 < /dev/null —— bash -s 是边读 stdin 边执行的，
#   命令一旦读走 stdin，后面的脚本正文就一起被吃掉了（本文件 05:54 那次就因此只跑了一半）。
(cd /opt/schola-haagen-dazs && docker compose exec -T schola node -e "
const D = require('better-sqlite3');
const db = new D('/app/data/schola.db', { readonly: true });
const cols = (t) => db.prepare('PRAGMA table_info(' + t + ')').all().map((c) => c.name);
const has = (t) => !!db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', t);
console.log('replies.kind   =', cols('replies').includes('kind') ? '有' : '缺');
console.log('ai_calls 表    =', has('ai_calls') ? '有（' + db.prepare('SELECT COUNT(*) AS c FROM ai_calls').get().c + ' 行）' : '缺');
console.log('certifications =', has('certifications') ? '有' : '缺');
console.log('coin_ledger 表 =', has('coin_ledger') ? '有（' + db.prepare('SELECT COUNT(*) AS c FROM coin_ledger').get().c + ' 行）' : '缺');
console.log('users.钱囊列   =', cols('users').includes('coin_balance') ? '有' : '缺');
console.log('papers.获币列  =', cols('papers').includes('tips') ? '有' : '缺');
console.log('integrity      =', db.pragma('integrity_check')[0].integrity_check);
" < /dev/null) 2>&1 || echo "(容器内查询失败——容器可能没在跑)"
echo

echo "--- 学正（AI）开馆状态 ---"
# 启动日志里那一行（lib/ai.ts 打的）就说明了：配没配 key、用的哪个模型与接口。
# 只读日志，不会打印密钥本身。
(cd /opt/schola-haagen-dazs && docker compose logs --tail 300 schola < /dev/null 2>&1 | grep -m2 "\[ai\]") 2>/dev/null \
  || echo "(日志里暂无 [ai] 行：容器可能还是旧镜像，或刚重启尚未输出)"

echo
echo "--- 入侵绊线自检 ---"
for p in /opt/ops /opt/sync.sh; do
  [ -e "$p" ] && echo "!! 发现可疑路径: $p" || echo "OK 无 $p"
done
echo "监听中的对外端口:"
ss -tlnp 2>/dev/null | grep -v "127.0.0.1" | head -10
echo "root 计划任务:"
crontab -l 2>&1 | head -5
