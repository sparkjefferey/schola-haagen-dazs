# GitHub 侧清理清单报告（2026-08-16）

> 用途：重装部署前的 GitHub 侧待办清单。代码层面已无异常（恶意提交 `ac87b5c` 不在任何分支），以下均为**非代码凭据/权限项**，需人工确认后处理。
> 本报告只读产出，未对 GitHub 做任何修改。

## 一、代码审查结论（已扫描，无需删除）

| 检查项 | 结果 |
|---|---|
| 恶意提交 `ac87b5c`（写入 ops-sync 公钥 + cron 自愈） | 不在任何分支，main 已回退干净 |
| `update.sh` / `deploy.sh` / `deploy.yml` / `codeql.yml` | 均为加固后版本，无后门 |
| 攻击者公钥字符串扫描 | 仅存在于防御文档与 monitor.sh（须保留） |
| reverse shell / cron 植入 / 危险 sink | 0 命中 |
| 仓库隐藏文件（.ops_ctl 等） | 无 |

## 二、待处理清单（按优先级）

### P0：账号会话（需浏览器操作，无法 API 完成）
- [ ] `github.com/settings/sessions`：吊销「小丑本的苹果」（2026-06-23 添加）与「jokerben 的窗户」（2026-08-15 添加，攻击当天）两个会话
- [ ] 确认 jokerben 是否有意持有你的账号登录权限；若无 → 改密码 + 开 2FA
- [ ] 检查 `github.com/settings/security-log` 8-15 当天是否还有 token/SSH key 新建事件

### P1：Actions secrets（事故前凭据，未轮换）
- [ ] 删除 `DEPLOY_KEY` / `DEPLOY_HOST` / `DEPLOY_USER`（均创建于 2026-08-14）
- [ ] 重装部署前重建：新密钥对 + 新 host + 非 root 部署用户
- [ ] 补建 `DEPLOY_FINGERPRINT`（当前 deploy.yml 引用它，缺失导致部署 fail-closed，属安全态）

### P2：仓库权限
- [ ] 协作者 `draintovmasyan783-creator`（push 权限）：确认是否继续授权
- [ ] main 无分支保护（免费版限制）：部署前再人工核对推送记录
- [ ] `codex/review-refactor` 过期分支：可删除缩小面

### P3：本地凭据
- [ ] `~/.ssh/dmit_key.pem`（旧 root 私钥，RSA 2048）停用/删除
- [ ] `.deploy-keys/` 旧密钥对作废，用重装前新生成的密钥
- [ ] 本机 gh token 轮换（`repo`+`workflow` scope）

## 三、监控保留项（不要删）
- 攻击者公钥指纹 `SHA256:4OA86CslkfOT9uNy4G2T4e1g6yIGgr4vN/drAYH5NAQ`
  `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDERLxCN6MRokchXQNQPJhN8TsInhv56xYmRUdr7VpDM9`
  （注释 `ops-sync@schola` / `root@jefferey-dmit-hk` 同源）—— monitor.sh 持续 grep，重现即报警

## 四、归因现状
- 恶意提交经 sparkjefferey 账号凭据推送（无 GPG 签名）
- 账号存在 jokerben 双设备会话，其中 Windows 设备添加于攻击当天
- 定性：共享账号/第三方会话执行，外部陌生 IP 接管可能性下降；最终以安全日志 IP 记录闭环
