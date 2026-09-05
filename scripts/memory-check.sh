#!/usr/bin/env bash
# 只读体检：内存占用全景——谁在吃、浮动来源、有没有 OOM 前科。不改任何状态。
set -u
cd /opt/schola-haagen-dazs || exit 1

echo "=== 0) 主机概览 ==="
uptime
echo
free -h
echo
echo "--- meminfo 关键项 ---"
grep -E "MemTotal|MemFree|MemAvailable|Buffers|^Cached|SReclaimable|Shmem:|SwapTotal|SwapFree|SwapCached" /proc/meminfo

echo
echo "=== 1) 按内存排序的进程 TOP14（RSS） ==="
ps aux --sort=-rss | head -15

echo
echo "=== 2) 容器视角（docker stats 快照） ==="
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}" < /dev/null

echo
echo "=== 3) schola 容器 Node 进程详情 ==="
CID=$(docker compose ps -q schola 2>/dev/null)
[ -z "${CID:-}" ] && CID=$(docker ps -q --filter name=schola | head -1)
echo "容器 ID: ${CID:-未找到}"
if [ -n "${CID:-}" ]; then
  NPID=$(docker inspect -f '{{.State.Pid}}' "$CID")
  echo "容器主进程 PID: ${NPID:-无}"
  if [ -n "${NPID:-}" ]; then
    grep -E "VmRSS|VmHWM|VmPeak|VmSwap" /proc/$NPID/status
    echo "--- smaps_rollup（RSS 构成） ---"
    grep -E "^(Rss|Pss|Anonymous|Shared|Private|Swap):" /proc/$NPID/smaps_rollup 2>/dev/null
  fi
  echo "--- 容器环境变量里的 NODE 配置 ---"
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CID" | grep -iE "NODE|MAX_OLD" || echo "(未设置 NODE_OPTIONS / 无内存上限)"
  echo "--- 容器内存上限 ---"
  docker inspect -f 'Memory limit: {{.HostConfig.Memory}} bytes' "$CID"
fi

echo
echo "=== 4) OOM / 内核回收记录（最近 8 条） ==="
dmesg -T 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -8 || true
J=$(journalctl -k --no-pager 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -8)
[ -n "$J" ] && echo "$J" || echo "(journalctl 无 OOM 记录或不可读)"

echo
echo "=== 5) 内存压力 PSI（内核视角的"挤不挤"） ==="
cat /proc/pressure/memory 2>/dev/null || echo "(本内核无 PSI)"

echo
echo "=== 6) Swap 现状 ==="
swapon --show 2>/dev/null || echo "(无 swap)"
echo "swappiness = $(cat /proc/sys/vm/swappiness 2>/dev/null || echo '?')"

echo
echo "=== 7) 最近 1 小时内存走势线索（监控/绊线脚本日志若有） ==="
ls -lt /opt/schola-haagen-dazs/backups/ 2>/dev/null | head -5
grep -riE "mem|oom" /opt/ops/*.log /var/log/syslog 2>/dev/null | tail -5 || echo "(无相关日志)"
