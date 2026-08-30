# sgen 项目

面向 Agent 的免费生图/生视频命令行工具（商汤 SenseNova + Agnes）。

## 本仓库须知

- 本仓库就是 `sgen` 命令的本体（`npm link` 已全局安装，`bin/sgen.js` 为入口）；改代码后无需重新安装，直接生效。
- 测试：`npm test`（黑盒：子进程跑 CLI + 本地假服务器，不打真实 API）；真机冒烟：`scripts/smoke`。
- 规格与工单在 `.scratch/sgen-cli/`；模型能力/限制的唯一事实来源是 `src/catalog.js`（改限制先改它，测试与 README 跟随）。
- 技能说明源文件在 `skill/sgen/SKILL.md`，正本安装于 `~/.agents/skills/sgen/`，修改后需同步（README 与 docs/agent-integration.md 有同步说明）。

## Agent skills

### Issue tracker

议题以本地 Markdown 存放于 `.scratch/<feature>/`。见 `docs/agents/issue-tracker.md`。

### Triage labels

五个标准分拣角色原样使用（`needs-triage` / `needs-info` / `ready-for-agent` / `ready-for-human` / `wontfix`）。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局（根 `CONTEXT.md` + `docs/adr/`）。见 `docs/agents/domain.md`。
