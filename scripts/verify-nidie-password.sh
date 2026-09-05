#!/usr/bin/env bash
# 只读验证：读取用户 id=9 当前 password_hash，与本地预计算的候选哈希做恒时比对。
# 只打印布尔值，不打印任何明文或哈希。跑完即删。
set -u
cd /opt/schola-haagen-dazs || exit 1

docker compose exec -T schola node -e "
const crypto = require('crypto');
const Database = require('better-sqlite3');
const db = new Database('/app/data/schola.db');
const row = db.prepare('SELECT id, username, password_hash FROM users WHERE id = 9').get();
if (!row) { console.error('RESULT=NO_USER'); process.exit(1); }
const parts = String(row.password_hash).split(':');
const salt = parts[0] || '';
const expect = Buffer.from(parts[1] || '', 'hex');
console.log('user=' + row.username + ' id=' + row.id + ' hashlen=' + expect.length);
function matches(hex) {
  const cand = Buffer.from(hex, 'hex');
  if (cand.length !== expect.length) return false;
  return crypto.timingSafeEqual(cand, expect);
}
console.log('exact_xmjsb_matches=' + matches('fd247ab0f5ca7b0aa912423e4f4204b9906a0cf2f8a7c089c16ab15401cf66787a97beaf839d0aa4d8ba3a511d1e72679bdfc860b60fd33186c905e8528e4641'));
console.log('leading_space_matches=' + matches('681f2e30e9dbf2b31c7982ea48785548dcc0cf9b94030a9941e04758ffbb2c55bf37f66baef6ff3227ee8c1bf5a8e76aaa005d470900a55b6e99f7d5b72a1aee'));
console.log('trailing_space_matches=' + matches('1fd0467db2038f9534b1c7803857166d890573d13be429125769753a1e20dcd7eda5b2a9874b323ef736d8cc585c57dd6301dd1ef8f92c0c9bf1247df10e6b2b'));
console.log('both_spaces_matches=' + matches('81ad79c97e09fea04d398265ac5bec207b0bc1362347cb3bab31f38c7551a4ce85dcf5eee4e7b188b507b37e9769ddfe4fe30f1c92322bd2870ff454361f3117'));
console.log('upper_case_matches=' + matches('9845725dece9bf860efb7a33853cad28de4acd2d7e500388037bedadf2b3b6bf1dc5bfc14ba9064bb9bfa5d7b3c401cc9b138930e9ee33cdea1092eb016b9c37'));
console.log('random_control_matches=' + matches(crypto.randomBytes(64).toString('hex')));
console.log('RESULT=DONE');
" < /dev/null
