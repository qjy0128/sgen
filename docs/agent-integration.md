# 让各个 AI 编程工具用上 sgen

> 2026-08-30 依据各家官方文档调研 + 本机实测整理。核心思路只有两步：**① 命令装好**（`npm link` 后 `sgen` 在 PATH 上，任何 Agent 的终端都能直接敲）；**② 教会 Agent**（靠各家的技能/规则文件，让它们知道"什么时候用、怎么用"）。

## 本机配置状态一览

`~/.agents/skills/sgen/` 是技能**正本**（Codex、dsh、Kimi Code、opencode、Trae、ZCode 都直接读这个目录——它正在成为跨工具事实标准）；其余工具按各自约定软链/写规则，均已配置完成：

| 工具 | 接入方式 | 本机状态 |
|---|---|---|
| ZCode | `~/.zcode/skills/sgen` 软链 | ✅ 已配置 |
| Codex | `~/.agents/skills/` 自动读取 ＋ `~/.codex/AGENTS.md` 说明块 | ✅ 已配置 |
| Claude Code | `~/.claude/skills/sgen` 软链 ＋ `~/.claude/CLAUDE.md` 说明块 | ✅ 已配置 |
| opencode | `~/.agents/skills/` 自动读取 ＋ `~/.config/opencode/AGENTS.md` | ✅ 已配置 |
| Qoder（国际版） | `~/.qoder/skills/sgen` 软链 ＋ `~/.qoder/AGENTS.md` | ✅ 已配置 |
| QoderCN（通义灵码 CLI） | `~/.qoder-cn/skills/sgen` 软链（国内版独立数据目录，与国际版不同路径） | ✅ 已配置 |
| Trae（国际版/国内版） | `~/.trae/skills/sgen` ＋ `~/.trae-cn/skills/sgen` 双软链 | ✅ 已配置 |
| Antigravity | `~/.gemini/config/skills/sgen` 软链 ＋ `~/.gemini/GEMINI.md` | ✅ 已配置 |
| dsh（DeepSeek） | 装好后自动读 `~/.agents/skills/` | ✅ 无需再配（本机未装，装好即用） |
| Kimi Code | 同上，自动读 `~/.agents/skills/` | ✅ 无需再配（本机未装） |
| mcode（MiniMax） | 无公开全局配置路径 → 在项目 `AGENTS.md` 里贴说明块 | ⚠️ 需按项目配置（见下） |
| WorkBuddy（腾讯） | 界面/对话式，无文件约定 → 对话里教一次 | ⚠️ 需手动教（见下） |

**验证方法**：在任意 Agent 里说"用 sgen 生成一张测试图"，它应该直接跑 `sgen image "..."` 并给你本地文件路径；或让它运行 `sgen models` 看能否列出模型。

## 各工具详细说明

### ZCode（智谱）
读全局 `~/.zcode/AGENTS.md`、项目 `AGENTS.md`；技能目录 `~/.zcode/skills/` 与 `~/.agents/skills/`。已通过软链接入，无需操作。

### Codex（OpenAI）
项目 `AGENTS.md` 逐层生效；全局 `~/.codex/AGENTS.md`（已追加 sgen 说明块）；技能读 `$HOME/.agents/skills`（已装）。
**注意沙箱**：`workspace-write` 档默认**禁网**，sgen 调不通 API。放行域名（写入 `~/.codex/config.toml` 的 `sandbox_workspace_config`，或对该命令临时用更高权限档）：
`token.sensenova.cn`、`apihub.agnes-ai.com`、`api.agnes-ai.cn`，以及生成结果的**下载域名**（商汤/Agnes 返回的临时 CDN 地址，按实际报错里的域名放行）。

### Claude Code（Anthropic）
**不读 AGENTS.md**（截至 2026-08 官方仍未支持），读 `CLAUDE.md`：全局 `~/.claude/CLAUDE.md`（已追加说明块）；技能只用 `~/.claude/skills/`（已软链，**不认** `~/.agents/skills/`）。若启用 `/sandbox`（Seatbelt），同样需要放行上述域名。

### opencode
全局 `~/.config/opencode/AGENTS.md`（已创建）；技能同时读 `~/.config/opencode/skills`、`~/.claude/skills`、`~/.agents/skills` 三处（已覆盖）。

### Qoder（阿里，国际版）与 QoderCN（通义灵码 CLI，国内版）
两个版本是**独立数据目录**（官方文档区分）：国际版 `~/.qoder/skills/`，国内版 `~/.qoder-cn/skills/`（项目级统一为 `.qoder/skills/`）。两处均已软链。手动放置是官方支持的方式（"Create Manually"），放入后重启 IDE 或 CLI 里 `/skills reload` 即可，无需 `npx skills add`。Qoder CLI 全局指令 `~/.qoder/AGENTS.md`（已写入）。

### Trae（字节）
国际版全局技能 `~/.trae/skills`、国内版 `~/.trae-cn/skills`——两处均已软链，哪个版本装上都能直接读到。项目规则 `.trae/rules/`（Markdown＋frontmatter，`alwaysApply` 等）；根目录 `AGENTS.md` 需在设置 > 规则 > 导入设置中开启。项目内 `.agents/skills/` 目录也可用，但需在 设置 > 技能与命令 > 导入设置 打开"启用 .agents 技能目录"开关（同名时 `.trae/skills/` 优先）。

### dsh（DeepSeek Harness）
技能契约与 Claude Skills 完全兼容：项目 `.agents/skills/`、全局 `~/.agents/skills/`（已装，装好 dsh 即生效）。项目内放 `AGENTS.md` 也会被官方 loader 读取。

### Kimi Code（月之暗面）
全局 `~/.kimi-code/AGENTS.md` ＋ 跨工具 `~/.agents/AGENTS.md`；技能读 `~/.kimi-code/skills/` 与 `~/.agents/skills/`（已覆盖后者）。装好后即用。

### mcode（MiniMax Code）
项目 `AGENTS.md`（`mcode init` 生成）是主要杠杆；全局配置与技能目录官方未公开。**在每个项目里贴这段**（即全局规则文件里同款说明块）：

```markdown
## sgen：生图/生视频 CLI（全局可用）
需要产出图片或视频时（配图/海报/图生图/文生视频/图生视频/首尾帧/参考素材），直接在终端调用 `sgen`，不要自己写 HTTP 调用：
- 生图：`sgen image "提示词" [--size 2K] [--ratio 16:9] [--image 参考图...] [--model 模型名] [--json]`
- 生视频：`sgen video "提示词" [--seconds 5] [--first-frame 图] [--last-frame 图] [--ref-image 图] [--ref-audio 音频] [--no-wait]`
- 查询/续等视频任务：`sgen status <video_id> --wait`；查模型与限制：`sgen models`
- 默认模型免费；唯一收费模型 agnes-video-2.5 必须显式 `--model` 点名且先出预估费用
- 参考素材传本地路径；stdout 输出本地文件路径；退出码 0 成功 / 2 用法错 / 1 API 错
- 详细用法：`sgen --help` 或 ~/.agents/skills/sgen/SKILL.md
```

### WorkBuddy（腾讯）
桌面办公 Agent，技能经界面/技能市场管理，无本地文件约定（编程场景走同门 CodeBuddy：其 CLI 读 `~/.codebuddy/CODEBUDDY.md` 与 `~/.codebuddy/skills/`，格式兼容，照 Qoder 的方式软链即可）。**对 WorkBuddy 本体，在对话里粘贴这段教它**：

> 我电脑上装了生图/生视频命令行工具 sgen。以后我让你生成图片/视频时，直接运行终端命令：生图 `sgen image "提示词" --size 2K`；改图 `sgen image "要求" --image 图片路径`；生视频 `sgen video "提示词" --seconds 5`；视频没等完就续等 `sgen status <video_id> --wait`。命令成功后输出里会有生成的本地文件路径。查可用模型跑 `sgen models`。默认模型免费；`--model agnes-video-2.5` 是收费的，除非我明确要求否则不要用。

### Antigravity（Google）
全局规则 `~/.gemini/GEMINI.md`（已写入）；全局技能 `~/.gemini/config/skills/`（已软链）；项目级用 `.agents/rules/` 与根目录 `GEMINI.md`/`AGENTS.md`。若开启终端沙箱（`enableTerminalSandbox`），需放行前述域名。

## 团队/项目级分发（可选）

想让某个项目里的所有人（不管用什么工具）都自动会用 sgen：把本仓库 `skill/sgen/` 目录复制到目标项目的 `.agents/skills/sgen/`——Codex、Kimi Code、opencode、Trae、Antigravity、ZCode 的**项目级**技能目录都认这个位置；Claude Code 用户另需 `.claude/skills/`（可软链）。再在项目 `AGENTS.md` 里加上面 mcode 小节那段说明块即可全覆盖。

## 官方规范校验记录（2026-08-30）

SKILL.md 与各目录放置方式已逐家对照官方文档核验（含源码级确认）：

| 校验项 | 官方要求 | sgen 实况 | 结论 |
|---|---|---|---|
| name 约束 | agentskills.io：1–64 字符、仅小写/数字/连字符、**须与父目录同名**；opencode/dsh 有同等正则 | `sgen`（4 字符，与目录一致） | ✅ |
| description 上限 | agentskills.io/opencode/Qoder ≤1024；Claude Code 列表截断 1536；dsh 目录展示截断 500 | 233 字符 | ✅ |
| description 写法 | 多行折叠 `>-` 仅两家源码级确认接受，其余"未说明" | 已改为**单行引号字符串**，全部解析器安全 | ✅（已加固） |
| SKILL.md 体量 | agentskills.io/Claude 建议 <500 行 | 63 行 | ✅ |
| `~/.agents/skills/` 官方背书 | Codex、dsh、Kimi Code、opencode 文档明确列为用户级目录 | 技能正本在此 | ✅ |
| 符号链接 | **Claude Code 官方明文支持**（"can be a symlink to a directory elsewhere on disk"）；其余家未提及但不禁止 | 正本一份 + 各处软链 | ✅ |
| Antigravity 全局规则 | `~/.gemini/GEMINI.md` 官方路径；规则文件单文件 ≤12,000 字符 | 已写入，远低于上限 | ✅ |
| Qoder 手动放置 | 官方"Create Manually"路径，无需安装器 | 软链放置 | ✅ |
| dsh 发现深度 | 官方"只发现一层 `<root>/<name>/SKILL.md`，不递归" | 正好一层 | ✅ |

唯一无解的两家：mcode（官方未公开技能/全局配置路径）、WorkBuddy（界面管理），按上文手动方式接入。

## 维护

- 改了 `skill/sgen/SKILL.md` 后，运行 `scripts/install-skill` 一键同步（正本一份 + 五处软链，秒级完成）。
- 六份全局规则文件（`~/AGENTS.md`、`~/.claude/CLAUDE.md`、`~/.codex/AGENTS.md`、`~/.config/opencode/AGENTS.md`、`~/.qoder/AGENTS.md`、`~/.gemini/GEMINI.md`）目前都含同一段 sgen 说明；要改文案建议六处同步，或干脆把其中几份软链到 `~/AGENTS.md` 统一维护。
- 排查"Agent 不会用"：先让 Agent 跑 `which sgen`（PATH 问题）→ `sgen models`（技能没被读到，检查对应文件）→ `sgen image "测试" --json`（网络/沙箱问题，看报错域名）。

## 沙箱与网络速查

| 工具 | 网络限制 | 处理 |
|---|---|---|
| Codex | `workspace-write` 默认禁网 | `sandbox_workspace_config` 放行域名或提权 |
| Claude Code | `/sandbox` 启用时禁网 | 放行域名或不在沙箱内跑 sgen |
| Antigravity | 终端沙箱开关 | 放行域名 |
| 其余 | 审批门控（弹窗放行即可） | 首次使用时批准 |

需放行的域名：`token.sensenova.cn`、`apihub.agnes-ai.com`、`api.agnes-ai.cn` ＋ 生成结果的临时下载域名（以实际报错为准）。
