# 议题仓库：本地 Markdown

本仓库的议题和规格以 Markdown 文件形式存放在 `.scratch/` 下。

## 约定

- 每个功能一个目录：`.scratch/<feature-slug>/`
- 规格文件：`.scratch/<feature-slug>/spec.md`
- 实现工单：每张一个文件，位于 `.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，禁止合并成单个大文件
- 分拣状态记录在文件顶部附近的 `Status:` 行（角色字符串见 `triage-labels.md`）
- 评论与对话历史追加到文件底部的 `## Comments` 标题下

## 当技能说"发布到议题仓库"时

在 `.scratch/<feature-slug>/` 下新建文件（目录不存在则先创建）。

## 当技能说"取相关工单"时

读取对应路径的文件。用户一般会直接给出路径或工单编号。

## 寻路操作（供 /wayfinder 使用）

- **地图**：`.scratch/<effort>/map.md`（Notes / Decisions-so-far / Fog 正文）
- **子工单**：`.scratch/<effort>/issues/NN-<slug>.md`，从 `01` 编号，正文写问题；`Type:` 行记录类型（`research`/`prototype`/`grilling`/`task`）；`Status:` 行记录 `claimed`/`resolved`
- **阻塞**：文件顶部附近一行 `Blocked by: NN, NN`；所列工单全部 `resolved` 才解除阻塞
- **前沿**：扫描 `.scratch/<effort>/issues/` 中开放、未阻塞、未认领的工单，编号小者优先
- **认领**：动手前先写 `Status: claimed` 并保存
- **解决**：在 `## Answer` 标题下追加答案，置 `Status: resolved`，并把要点（gist + 链接）追加到 `map.md` 的 Decisions-so-far
