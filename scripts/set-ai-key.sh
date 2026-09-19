#!/usr/bin/env bash
# 把「学正」的模型密钥写进服务器 .env（供 set-ai-key 工作流远程调用）
#
# 约定：
#   - 密钥由 CI 以环境变量 AI_API_KEY 下发，本脚本**绝不回显明文**，日志里只出现长度与哈希前缀；
#   - 只替换 .env 中 AI_* 这几项，其余既有配置（邀请码、SMTP 等）原样保留；
#   - 写前先备份，写完做一次「读回并比对哈希」的自证。
# 用法：由 .github/workflows/set-ai-key.yml 经 ssh 'bash -s' 喂入执行。
set -uo pipefail

APP_DIR=/opt/schola-haagen-dazs
cd "$APP_DIR" || { echo "!! 找不到项目目录 $APP_DIR"; exit 1; }

key="${AI_API_KEY:-}"
if [ -z "$key" ]; then
  echo "!! 未收到密钥（AI_API_KEY 为空）——未做任何改动"
  exit 1
fi
case "$key" in
  sk-*) ;;
  *) echo "!! 密钥形态异常（应以 sk- 开头）——未做任何改动，请核对后重试"; exit 1 ;;
esac

if [ -f .env ]; then
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  cp -a .env ".env.bak.${stamp}"
  echo ">> 已备份 .env → .env.bak.${stamp}"
  echo ">> 原有变量名（仅名字）：$(grep -oE '^[A-Z_]+' .env | sort -u | tr '\n' ' ')"
else
  echo ">> 服务器上还没有 .env，将新建一份"
fi

tmp="$(mktemp)"
if [ -f .env ]; then
  grep -vE '^(AI_API_KEY|AI_BASE_URL|AI_MODEL|AI_DAILY_PER_USER|AI_DAILY_GLOBAL|AI_MAX_CONCURRENT|AI_MAX_INPUT_CHARS|AI_TIMEOUT_MS)=' .env > "$tmp" || true
fi
{
  cat "$tmp"
  echo ""
  echo "# ---- 学正 · AI 点评（由 CI 写入，$(date -u +%Y-%m-%d)）----"
  printf 'AI_API_KEY=%s\n' "$key"
  echo "AI_BASE_URL=https://api.deepseek.com"
  echo "AI_MODEL=deepseek-flash"
  echo "AI_DAILY_PER_USER=3"
  echo "AI_DAILY_GLOBAL=50"
  echo "AI_MAX_CONCURRENT=2"
  echo "AI_MAX_INPUT_CHARS=12000"
  echo "AI_TIMEOUT_MS=60000"
} > .env
rm -f "$tmp"
chmod 600 .env

# 自证：从磁盘读回，与下发的密钥比哈希（不回显明文）
want="$(printf '%s' "$key" | sha256sum | cut -c1-16)"
got="$(grep -m1 '^AI_API_KEY=' .env | cut -d= -f2- | tr -d '\n' | sha256sum | cut -c1-16)"
echo ">> 密钥长度 ${#key}，期望指纹 $want，磁盘读回指纹 $got"
if [ "$want" != "$got" ]; then
  echo "!! 写回内容与下发的密钥不一致——已中止（请勿重启容器，先人工检查 .env）"
  exit 1
fi

echo ">> .env 最终内容（密钥已打码）："
sed -E 's/^(AI_API_KEY=).*/\1<已设置>/' .env | grep -E '^[A-Z_]+=' | sed 's/^/   /'
echo ">> 完成。下一步：跑一次常规部署（update.sh）让容器带上新 env。"
