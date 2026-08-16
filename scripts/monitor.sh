#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 入侵绊线（Detection Tripwire）
#  两层检测：
#    第一层 签名式 —— 盯已知指纹（换密钥/改目录名即失效）
#    第二层 行为式 —— 盯"反常现象"，不依赖已知指纹
#                    （高水平攻击者也能被这类异常暴露）
#  部署：装成 cron 每 15 分钟跑一次（见 harden-host.sh / 文档）。
#  依赖：bash、coreutils、grep、ss、curl（仅告警时用）。纯只读检查，不改动系统。
#  配置（环境变量，可空）：
#    ALERT_WEBHOOK  告警推送地址，留空则只写 /var/log/schola-security.log
#    AUTO_SHUTDOWN  设为 1 则在触发时直接关机（激进，默认 0）
#    SSH_PORT       你的 sshd 端口（默认 22），用于判定"是否多了不该听的端口"
# ============================================================
set -u
LOG=/var/log/schola-security.log
BASE_DIR=/var/lib/schola-tripwire
BASELINE="$BASE_DIR/baseline.sha"
PROC_BASELINE="$BASE_DIR/procs.sha"
SSH_PORT="${SSH_PORT:-22}"

# 攻击者公钥指纹中的唯一片段（来自 2026-08-15 取证）
ATTACK_KEY="DERLxCN6MRokchXQNQPJhN8TsInhv56xYmRUdr7VpDM9"
ATTACK_COMMENT="root@jefferey-dmit-hk"
ALERTS=()
mkdir -p "$BASE_DIR" 2>/dev/null || true

# ---------- 第一层：签名式（已知指纹） ----------
# 1) 攻击公钥是否重现
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] || continue
  if grep -q "$ATTACK_KEY" "$f" || grep -q "$ATTACK_COMMENT" "$f"; then
    ALERTS+=("签名匹配: 攻击公钥重现于 $f")
  fi
done
# 2) 已知后门路径
[ -d /opt/ops ] && ALERTS+=("签名匹配: /opt/ops 后门目录存在")
# 3) 可疑 systemd 单元内容
for s in /etc/systemd/system/*.service /etc/systemd/system/*.service.d/*.conf; do
  [ -f "$s" ] || continue
  if grep -qiE 'sync\.sh|schola-ops|/opt/ops' "$s"; then
    ALERTS+=("签名匹配: 可疑 systemd 单元 $s")
  fi
done
# 4) SSH 防护被悄悄撤掉
grep -rqiE '^\s*PasswordAuthentication\s+yes' /etc/ssh/sshd_config 2>/dev/null \
  && ALERTS+=("签名匹配: SSH PasswordAuthentication 被重新启用")
grep -rqiE '^\s*PermitRootLogin\s+(yes|without-password|prohibit-password)' /etc/ssh/sshd_config 2>/dev/null \
  && ALERTS+=("签名匹配: PermitRootLogin 被放宽（应为 no）")

# ---------- 第二层：行为式（不依赖已知指纹） ----------
# 5) 关键目录/文件完整性基线（首次运行建立，之后任何改动都报）
#    监控面：sshd 配置、systemd units、cron、/opt、root 的 ssh 目录、sudoers
MON_DIRS=(/etc/ssh /etc/systemd/system /etc/cron.d /etc/cron.daily /etc/cron.hourly \
          /etc/cron.weekly /etc/cron.monthly /var/spool/cron /opt /root/.ssh /etc/sudoers.d)
if [ ! -f "$BASELINE" ]; then
  # 受信首次运行（harden 之后）建基线
  for d in "${MON_DIRS[@]}"; do
    [ -e "$d" ] && find "$d" -type f 2>/dev/null
  done | sort -u | while read -r f; do
    sha256sum "$f" 2>/dev/null
  done > "$BASELINE" 2>/dev/null
  echo "$(date -Iseconds) 已建立完整性基线: $BASELINE" >> "$LOG"
else
  CUR=$(mktemp)
  for d in "${MON_DIRS[@]}"; do
    [ -e "$d" ] && find "$d" -type f 2>/dev/null
  done | sort -u | while read -r f; do
    sha256sum "$f" 2>/dev/null
  done > "$CUR" 2>/dev/null
  # 新增 / 改动 的文件
  comm -13 <(cut -d' ' -f2- "$BASELINE" | sort -u) <(cut -d' ' -f2- "$CUR" | sort -u) \
    | while read -r nf; do ALERTS+=("行为异常: 关键路径新增/改动文件 $nf"); done
  # 被删的文件（基线有、现在无）
  comm -23 <(cut -d' ' -f2- "$BASELINE" | sort -u) <(cut -d' ' -f2- "$CUR" | sort -u) \
    | while read -r df; do ALERTS+=("行为异常: 关键路径文件被删除 $df"); done
  rm -f "$CUR"
fi

# 6) 不该监听的端口（期望只听 sshd 在 $SSH_PORT，以及 127.0.0.1:3000）
#    任何 0.0.0.0 / :: 上的其它监听 = 异常
if command -v ss >/dev/null 2>&1; then
  while read -r line; do
    [ -z "$line" ] && continue
    port=$(echo "$line" | awk '{print $4}' | rev | cut -d: -f1 | rev)
    addr=$(echo "$line" | awk '{print $4}' | rev | cut -d: -f2- | rev)
    # 跳过期望项：sshd 端口、本地 3000
    [ "$port" = "$SSH_PORT" ] && continue
    [ "$port" = "3000" ] && case "$addr" in 127.*|::1|localhost) continue;; esac
    ALERTS+=("行为异常: 发现意外监听 $addr:$port")
  done < <(ss -tlnp 2>/dev/null | grep -E ':(0\.0\.0\.0|\[?::\]?)' | awk '{print $4}')
fi

# 7) 从 /tmp /dev/shm /var/tmp 跑的进程（反弹 shell / 内存马常见藏身处）
for p in /proc/[0-9]*/exe; do
  tgt=$(readlink "$p" 2>/dev/null) || continue
  case "$tgt" in
    /tmp/*|/dev/shm/*|/var/tmp/*|/opt/ops/*) ALERTS+=("行为异常: 进程从可疑路径执行 $tgt ($(basename $(dirname $p)))");;
  esac
done

# 8) 新增 SUID/SGID 文件（提权常用）
SUID_NOW=$(mktemp)
find / \( -path /proc -o -path /sys -o -path /var/lib/docker \) -prune -o \
  -type f \( -perm -4000 -o -perm -2000 \) -print 2>/dev/null | sort -u > "$SUID_NOW"
if [ -f "$BASE_DIR/suid.baseline" ]; then
  comm -13 "$BASE_DIR/suid.baseline" "$SUID_NOW" | while read -r s; do
    ALERTS+=("行为异常: 新增 SUID/SGID 文件 $s")
  done
else
  cp "$SUID_NOW" "$BASE_DIR/suid.baseline" 2>/dev/null
fi
rm -f "$SUID_NOW"

# 9) 已加载内核模块变化（LKM rootkit 迹象）
if [ -d /sys/module ]; then
  MOD_NOW=$(ls /sys/module | sort -u)
  if [ -f "$BASE_DIR/modules.baseline" ]; then
    comm -13 "$BASE_DIR/modules.baseline" <(echo "$MOD_NOW") | while read -r m; do
      ALERTS+=("行为异常: 新增内核模块 $m")
    done
  else
    echo "$MOD_NOW" > "$BASE_DIR/modules.baseline" 2>/dev/null
  fi
fi

# 10) 非预期进程以 root 运行（允许列表之外出现交互式 shell / 脚本解释器）
ALLOWED_ROOT_PROCS="sshd|systemd|containerd|dockerd|cloudflared|cron|rsyslog|dbus|networkd|udevd?|nginx|node|monitor.sh|harden-host.sh|update.sh|deploy.sh"
while read -r user pid cmd; do
  [ "$user" = "root" ] || continue
  # 只盯真正的交互 shell / 解释器
  echo "$cmd" | grep -qE '(^|/)(bash|sh|zsh|python3?|perl|ruby|nc|ncat|socat|telnet|php)( |$)' || continue
  echo "$cmd" | grep -qE "$ALLOWED_ROOT_PROCS" && continue
  ALERTS+=("行为异常: root 下出现非预期解释器进程: $cmd (pid $pid)")
done < <(ps -eo user=,pid=,cmd= 2>/dev/null)

# ---------- 处置 ----------
if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="$(date -Iseconds) SCHOLA 安全绊线触发(${#ALERTS[@]}项): $(printf '%s; ' "${ALERTS[@]}")"
  echo "$MSG" >> "$LOG"
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -fsS -X POST "${ALERT_WEBHOOK}" -H 'Content-Type: application/json' \
      -d "{\"text\":\"${MSG}\"}" >/dev/null 2>&1 || true
  fi
  if [ "${AUTO_SHUTDOWN:-0}" = "1" ]; then
    shutdown -h now "SCHOLA SECURITY TRIPWIRE"
  fi
  exit 1
fi
exit 0
