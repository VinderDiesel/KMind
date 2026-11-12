# 团队项目 Vault 验收清单

在业务仓根执行一次：`kmind init --project`，再按下列步骤验证。

## 机器 A

1. `kmind init --project` 成功；存在 `.kmind-knowledge/config.yaml`、`.kmind-knowledge/FEATURE_TREE.md`、`.githooks/pre-commit`、`AGENTS.md`（含 `kmind:agent-protocol`）。
2. `kmind capture`（或 MCP `kmind_capture`）写入一张带真实 `project` 的卡，并更新 `FEATURE_TREE.md` 对应行为 `done` + id。
3. `git status` 可见 `.kmind-knowledge/knowledge/...` 与 `FEATURE_TREE.md`；commit + push（勿提交 `index.db` / `raw/`）。

## 机器 B

1. `git pull`；hooks 触发后本地应有可用索引（或手动 `kmind --vault .kmind-knowledge reindex`）。
2. 在仓内跑 `kmind pack --query "<A 卡标题关键词>"`（或 MCP `kmind_pack`）能命中 A 的卡。
3. B 再 capture 一张卡 → commit → push。

## 机器 A 再拉

1. `git pull` → pack/search 能看到 B 的卡。

## AGENTS 合并

1. 预先自建 `AGENTS.md` 含团队原文 → 再 `kmind init --project` 或 `kmind skills install cursor --project`。
2. 原文仍在；文末或标记内出现 KMind 协议区块；二次安装不丢团队内容。

## 红线抽检

- [ ] `.gitignore` 忽略 `index.db`、`raw/`
- [ ] 无静默 `git push`
- [ ] 新 id 形如 `k-YYYY-MM-DD-NNN-<4hex>`（可用 `KMIND_AUTHOR=alice` 区分后缀）
