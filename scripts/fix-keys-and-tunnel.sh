#!/usr/bin/env bash
# 一次性维护（有写操作，谨慎执行）：
#   1) 清理 ~/.ssh/authorized_keys 中完全重复的公钥（先备份，异常自动回滚）
#   2) 重启 cloudflared 临时隧道，并把日志落盘，以便取回新的公网地址
#      —— 先启动新进程并验证成功，再停旧进程，避免站点中断
# 由 GitHub Actions 通过 ssh 'bash -s' 喂进来执行，本地不要直接跑。
set -u

AK="$HOME/.ssh/authorized_keys"
TARGET="github-actions-deploy-20260831"

echo "=== 1) 清理重复公钥 ==="
BAK="$AK.bak.$(date +%s)"
cp -a "$AK" "$BAK" && echo "已备份: $BAK"
echo "清理前行数: $(wc -l < "$AK")"

awk '!seen[$0]++' "$BAK" > "$AK.new"
mv "$AK.new" "$AK"
chmod 600 "$AK"
echo "清理后行数: $(wc -l < "$AK")"

N=$(grep -c "$TARGET" "$AK" || true)
echo "目标公钥($TARGET)条数: $N"
if [ "$N" != "1" ]; then
  echo "!! 条数异常，回滚备份"
  cp -a "$BAK" "$AK"
  exit 1
fi

echo "剩余钥匙指纹:"
ssh-keygen -lf "$AK" 2>&1 | awk '{print "  " $2, $3}'
echo "公钥清理 OK"
echo

echo "=== 2) 重启 cloudflared 隧道 ==="
echo "启动前进程:"
pgrep -af "cloudflared" || echo "  无"

LOG=/root/cloudflared.log
: > "$LOG"
setsid nohup /usr/local/bin/cloudflared --no-autoupdate --logfile "$LOG" \
  tunnel --url http://127.0.0.1:3000 > /root/cloudflared.out 2>&1 < /dev/null &
echo "已发起启动，等待 22 秒..."
sleep 22

# 用命令行里的 --logfile 特征来区分新进程，避免误判成旧进程
NEW=$(pgrep -f "cloudflared.*--logfile" | tr '\n' ' ')
echo "新进程(带 --logfile) PID: ${NEW:-未找到}"
if [ -z "$NEW" ]; then
  echo "!! 新隧道未起来。cloudflared.out 末尾："
  tail -5 /root/cloudflared.out 2>&1
  echo "旧进程保持不动，已中止"
  exit 1
fi

echo "--- 新隧道地址 ---"
TUNNEL=$(grep -ohE "https://[a-zA-Z0-9._-]+\.trycloudflare\.com" "$LOG" /root/cloudflared.out 2>/dev/null | sort -u | tail -1)
echo "$TUNNEL"
echo

echo "=== 3) 停掉不带 --logfile 的旧进程 ==="
ALL=$(pgrep -f "cloudflared tunnel" | tr '\n' ' ')
for p in $ALL; do
  case " $NEW " in
    *" $p "*) echo "保留新进程 $p" ;;
    *) echo "停止旧进程 $p"; kill "$p" 2>/dev/null || true ;;
  esac
done
sleep 3
echo "当前全部 cloudflared 进程:"
pgrep -af "cloudflared" | grep -v grep || echo "  无"
echo

echo "=== 3.5) 从公网侧验证隧道 ==="
if [ -n "$TUNNEL" ]; then
  sleep 5
  curl -s -o /dev/null -w "公网访问 HTTP=%{http_code}\n" --max-time 20 "$TUNNEL" 2>&1
else
  echo "未取到地址，跳过验证"
fi
echo

echo "=== 4) 验证站点 ==="
curl -s -o /dev/null -w "本地 3000 端口 HTTP=%{http_code}\n" --max-time 10 http://127.0.0.1:3000/
echo "维护结束"
