#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 入侵绊线（Detection Tripwire）
#  作用：定期扫描「攻击者是否重新拿到 root / 留下后门」。
#  部署：装成 cron 每 15 分钟跑一次（见 harden-host.sh 或文档）。
#  依赖：bash、grep、curl（仅告警时用）。纯只读检查，不改动系统。
#  配置（环境变量，可空）：
#    ALERT_WEBHOOK  告警推送地址（如企业微信/钉钉/Slack incoming webhook），
#                    留空则只在 /var/log/schola-security.log 留记录。
#    AUTO_SHUTDOWN  设为 1 则在触发时直接关机（激进，默认 0）。
# ============================================================
set -u
LOG=/var/log/schola-security.log
# 攻击者公钥指纹中的唯一片段（来自 2026-08-15 取证）
ATTACK_KEY="DERLxCN6MRokchXQNQPJhN8TsInhv56xYmRUdr7VpDM9"
ATTACK_COMMENT="root@jefferey-dmit-hk"
ALERTS=()

# 1) 攻击公钥是否重现（任何账户的 authorized_keys）
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] || continue
  if grep -q "$ATTACK_KEY" "$f" || grep -q "$ATTACK_COMMENT" "$f"; then
    ALERTS+=("攻击公钥指纹重现于 $f")
  fi
done

# 2) 已知后门路径 /opt/ops 是否重建
[ -d /opt/ops ] && ALERTS+=("/opt/ops 后门目录存在")

# 3) 可疑 systemd 服务（名字/内容含 ops/sync/未知脚本）
for s in /etc/systemd/system/*.service /etc/systemd/system/*.service.d/*.conf; do
  [ -f "$s" ] || continue
  if grep -qiE 'sync\.sh|schola-ops|/opt/ops' "$s"; then
    ALERTS+=("可疑 systemd 单元: $s")
  fi
done

# 4) SSH 密码登录是否被悄悄重新打开
if grep -rqiE '^\s*PasswordAuthentication\s+yes' /etc/ssh/sshd_config; then
  ALERTS+=("SSH PasswordAuthentication 被重新启用")
fi

# 5) root 直接登录是否被放宽
if grep -rqiE '^\s*PermitRootLogin\s+(yes|without-password|prohibit-password)' /etc/ssh/sshd_config; then
  ALERTS+=("PermitRootLogin 被放宽（应为 no）")
fi

# 6) 任何新出现的、非我们部署的常驻服务（粗筛：名字不含 schola/cloudflared/docker）
for u in $(systemctl list-unit-files --type=service --no-legend 2>/dev/null | awk '{print $1}'); do
  case "$u" in
    *schola*|*cloudflared*|*docker*|*ssh*|*systemd*|*dbus*|*network*|*rsyslog*|*cron*|*apparmor*|*ufw*|*unattended*) continue ;;
  esac
  # 仅报告我们没见过的（简单基线：/etc/我们已知的留白，这里只列可疑）
  if echo "$u" | grep -qiE 'ops|sync|backdoor|watch|guard|helper|update-' ; then
    ALERTS+=("可疑未知服务: $u")
  fi
done

if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="$(date -Iseconds) SCHOLA 安全绊线触发: $(printf '%s; ' "${ALERTS[@]}")"
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
