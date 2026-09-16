#!/usr/bin/env bash
# 经 GitHub Actions 曲线 SSH 触发服务器自更新：备份 DB → git pull → 写 version.json → 重建容器。
# 幂等可重复执行；代码 push 到 main 后跑本脚本即可发布。
set -u
cd /opt/schola-haagen-dazs || exit 1

echo "=== 更新前 commit ==="
git rev-parse --short HEAD

echo
echo "=== 执行 update.sh ==="
if bash update.sh < /dev/null 2>&1; then
  echo
  echo "=== update.sh 执行成功 ==="
else
  rc=$?
  echo
  echo "!!! update.sh 失败（退出码 $rc）—— 线上仍是旧版本！"
  echo "!!! 宿主机 public/version.json 已按本次 commit 改写，但新镜像未构建成功；"
  echo "!!! 旧容器继续服务，页面显示的仍是上一版 commit（与实际运行版本一致，不会误报）。"
  echo "!!! 请修复后重跑本脚本。"
  echo
  echo "=== 当前容器状态 ==="
  docker compose ps < /dev/null
  exit "$rc"
fi

echo
echo "=== 更新后 commit 与 version.json ==="
git rev-parse --short HEAD
cat public/version.json 2>/dev/null || true

echo
echo "=== 容器状态 ==="
docker compose ps < /dev/null
