#!/usr/bin/env bash
# 临时脚本：经 GitHub Actions 曲线 SSH 重置用户「逆蝶」的密码。
# 新哈希按 lib/auth.ts 的 scrypt(salt:hash) 格式在本地生成后嵌入本文件，
# 明文密码不进仓库、不进日志。执行成功后本文件将被 git rm（用后即删）。
set -u

cd /opt/schola-haagen-dazs || exit 1

NEW_HASH='cfd3c5b2fc1afc58b8420adedf427e65:fd247ab0f5ca7b0aa912423e4f4204b9906a0cf2f8a7c089c16ab15401cf66787a97beaf839d0aa4d8ba3a511d1e72679bdfc860b60fd33186c905e8528e4641'

echo "=== 1) 备份数据库 ==="
TS=$(date +%s)
BAK="/app/data/schola.db.bak.reset-nidie-${TS}"
docker compose exec -T schola sh -c "cp /app/data/schola.db ${BAK} && ls -l ${BAK}" < /dev/null

echo
echo "=== 2) 定位账号并写入新哈希 ==="
docker compose exec -T schola node -e "
const crypto = require('crypto');
const Database = require('better-sqlite3');
const NEW_HASH = '${NEW_HASH}';
const TARGET = '逆蝶';
function shape(v) { const p = String(v).split(':'); return p.length === 2 && p[0].length === 32 && p[1].length === 128; }
const db = new Database('/app/data/schola.db');
const matches = db.prepare('SELECT id, username, display_name, role, status FROM users WHERE username = ? OR display_name = ?').all(TARGET, TARGET);
if (matches.length === 0) {
  const like = db.prepare('SELECT id, username, display_name FROM users WHERE username LIKE ? OR display_name LIKE ?').all('%'+TARGET+'%', '%'+TARGET+'%');
  console.error('RESULT=NO_MATCH candidates=' + JSON.stringify(like));
  process.exit(1);
}
if (matches.length > 1) {
  console.error('RESULT=AMBIGUOUS ' + JSON.stringify(matches));
  process.exit(1);
}
const row = matches[0];
console.log('RESULT=MATCH id=' + row.id + ' username=' + row.username + ' display_name=' + row.display_name + ' role=' + row.role + ' status=' + row.status);
const oldHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(row.id).password_hash;
if (!shape(oldHash)) { console.error('RESULT=OLD_FORMAT_ODD len=' + String(oldHash).length); process.exit(1); }
const info = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(NEW_HASH, row.id);
const after = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(row.id).password_hash;
console.log('update_changes=' + info.changes);
console.log('write_matches_new=' + (after === NEW_HASH));
console.log('hash_changed=' + (oldHash !== after));
console.log('new_format_ok=' + shape(after));
console.log('RESULT=DONE user_id=' + row.id);
" < /dev/null

echo
echo "=== 3) 站点健康抽查 ==="
CODE=$(docker compose exec -T schola sh -c "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login" < /dev/null 2>/dev/null)
echo "登录页 HTTP 状态: ${CODE}（200 即站点正常）"
