#!/usr/bin/env bash
# ============================================================
#  沙藏学馆 · 更新脚本（改了代码后，在服务器项目目录里跑）
#  用法： bash update.sh
#  前提：代码是用 git clone 拉下来的（这样 git pull 才有效）。
#        若是 scp 上传的，请重新 scp 覆盖后直接 bash deploy.sh。
# ============================================================
set -e
cd "$(dirname "$0")"

echo "=== 沙藏学馆 更新开始 ==="

# 更新前先备份持久化数据库。备份失败就停止，避免在没有恢复点的情况下重建容器。
backup_dir="${SCHOLA_BACKUP_DIR:-$PWD/backups}"
mkdir -p "$backup_dir"
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_file="$backup_dir/schola-data-preupdate-$backup_stamp.sqlite"
backup_tmp="$(mktemp "$backup_dir/.schola-data-preupdate.XXXXXX")"

echo ">> 备份现有数据库..."
if ! docker compose ps --status running -q schola | grep -q .; then
  rm -f "$backup_tmp"
  echo "!! schola 容器未运行，无法确认数据库备份；为保护数据，更新已停止。"
  exit 1
fi
if ! docker compose exec -T schola node -e '
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
const source = new Database("/app/data/schola.db", { readonly: true, fileMustExist: true });
const target = path.join(os.tmpdir(), `schola-${crypto.randomUUID()}.sqlite`);
(async () => {
  try {
    await source.backup(target);
    source.close();
    const snapshot = fs.readFileSync(target);
    fs.rmSync(target, { force: true });
    process.stdout.write(snapshot);
  } catch (error) {
    try { source.close(); } catch {}
    fs.rmSync(target, { force: true });
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
})();
' > "$backup_tmp"; then
  rm -f "$backup_tmp"
  echo "!! 数据库在线备份失败；为保护数据，更新已停止。"
  exit 1
fi
if [ ! -s "$backup_tmp" ]; then
  rm -f "$backup_tmp"
  echo "!! 数据库备份为空；为保护数据，更新已停止。"
  exit 1
fi
mv "$backup_tmp" "$backup_file"
echo ">> 数据库备份完成：$backup_file"

# 拉取最新代码（仅在是 git 仓库时）
if [ -d .git ]; then
  echo ">> 拉取最新代码..."
  # 自我保护：update.sh 自身也在仓库里，git pull 会改写磁盘上的它，而**正在运行的 bash
  # 已按旧内容读取**——于是本次仍执行旧逻辑，对 update.sh 的改动要等下一次部署才生效。
  # 本仓库就因此让「version.json 写入时机」的修复整整滞后了一个部署周期（日志里能看到
  # 「重新构建」早于「记录部署版本信息」）。故拉取后比对自身摘要，变了就重跑新版本。
  SELF_BEFORE=$(sha256sum "$0" 2>/dev/null | cut -d' ' -f1)
  git pull
  SELF_AFTER=$(sha256sum "$0" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$SELF_BEFORE" ] && [ "$SELF_BEFORE" != "$SELF_AFTER" ]; then
    echo ">> update.sh 自身已更新，重新执行新版本，使本次改动即时生效..."
    # 第二次执行时 git pull 已是空操作，不会无限递归。
    exec bash "$0" "$@"
  fi
else
  echo ">> 不是 git 仓库，跳过 git pull（请确认已手动更新了代码文件）"
fi

# 记录部署版本信息（供 /version 页面确认线上实际提交）。
# ⚠️ 必须在 docker compose build **之前**写入：Dockerfile 会把 public/ 打进镜像
#    （COPY --from=build /app/public ./public），容器内提供的是**构建时**的那份文件。
#    旧做法写在构建之后，只改了宿主机、容器里恒为上一版，导致 /version 永远滞后一版
#    ——反而彻底失去「凭 version.json 核对线上版本」的能力。
#    放在构建前，两种结果都准确：
#      · 构建成功 → 镜像内含本次 commit，页面显示正确；
#      · 构建失败（set -e 中止）→ 旧容器继续服务，页面仍显示上一版 commit，与实际一致。
#    （构建失败时宿主机的 public/version.json 已是新值，但该文件不入库、下次部署会覆盖，
#      线上页面显示的始终是正在运行的版本，故无影响。）
echo ">> 记录部署版本信息（供 /version 页面确认线上实际提交）..."
mkdir -p public
cat > public/version.json <<EOF
{
  "commit": "$(git rev-parse HEAD 2>/dev/null || echo unknown)",
  "ref": "$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)",
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo ">> 重新构建并重启容器..."
# 构建/启动任一失败即中止（set -e），旧容器继续服务、线上仍是上一版。
docker compose build
docker compose up -d

echo ""
echo "=== 更新完成 ✅ ==="
echo "访问： http://<你的服务器IP>:3000"
