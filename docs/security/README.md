# 安全文档中心

这里集中保存安全调查、应用审计、恢复操作手册和持续安全日志。根目录不再散放同类报告。

## 目录结构

```text
docs/security/
├── README.md
├── SECURITY_LOG.md
├── incidents/
│   ├── ROOT_INCIDENT_INVESTIGATION_2026-08-16.md
│   └── INCIDENT_REPORT_LEGACY.md
├── audits/
│   └── SECURITY_ADVERSARIAL_REPORT.md
└── runbooks/
    ├── INCIDENT_RECOVERY.md
    ├── DEPLOY_RECOVER.md
    └── SECURITY_MONITORING.md
```

## 文件用途与可信状态

| 文件 | 用途 | 状态 |
|---|---|---|
| [`incidents/ROOT_INCIDENT_INVESTIGATION_2026-08-16.md`](incidents/ROOT_INCIDENT_INVESTIGATION_2026-08-16.md) | root 失陷调查、证据分级、入口假设与取证计划 | **当前正式调查报告** |
| [`incidents/INCIDENT_REPORT_LEGACY.md`](incidents/INCIDENT_REPORT_LEGACY.md) | 较早的 Agent 复盘稿 | **历史材料；含未验证/冲突结论，不可单独引用** |
| [`audits/SECURITY_ADVERSARIAL_REPORT.md`](audits/SECURITY_ADVERSARIAL_REPORT.md) | 应用层对抗测试、漏洞与修复建议 | 应用审计材料；宿主机归因须另行验证 |
| [`runbooks/INCIDENT_RECOVERY.md`](runbooks/INCIDENT_RECOVERY.md) | root 失陷后的安全恢复清单 | 操作手册；旧主机不得执行 |
| [`runbooks/DEPLOY_RECOVER.md`](runbooks/DEPLOY_RECOVER.md) | 重装后的数据恢复和部署步骤 | 操作手册；仅供干净新系统使用 |
| [`runbooks/SECURITY_MONITORING.md`](runbooks/SECURITY_MONITORING.md) | 新系统监控与加固设计 | 设计/操作手册；需在新系统验证 |
| [`SECURITY_LOG.md`](SECURITY_LOG.md) | 按时间追加的重要发现、处置和待办 | 持续更新 |

## 使用规则

1. 事故事实必须标注“已确认、推断、待验证或已排除”。
2. 只有原始日志、文件哈希、提交记录、平台审计记录或所有者明确确认可以作为事实依据。
3. 不在文档中保存密码、私钥、会话令牌、API Token、完整 `.env` 或包含鉴权参数的 URL。
4. 旧主机材料默认不可信；只从关机快照只读提取，并为证据计算 SHA-256。
5. 新发现先追加到 `SECURITY_LOG.md`，形成证据闭环后再更新正式调查报告。
6. `INCIDENT_REPORT_LEGACY.md` 只用于保留历史推理，不能覆盖正式报告的证据等级。

