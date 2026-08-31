# sgen —— 面向 Agent 的免费生图/生视频命令行工具

一条命令调用商汤日日新（SenseNova）与 Agnes 的生图、生视频模型。给任何 AI 编程工具（ZCode、Claude Code、Cursor……）当"手"用：默认只走免费模型、结果自动下载到本地、参数在本机先校验（非法参数一个请求都不发）。

- **默认生图**：商汤 `sensenova-u1.5-lite`（支持 4K、无水印、公测免费）
- **默认生视频**：Agnes `agnes-video-2.5-flash`（720P、4–12 秒、限免 $0）
- 多把 API Key 自动轮换分摊额度，限流自动换下一把
- 视频异步任务自动轮询等待，`--no-wait` + `sgen status` 随时中断/恢复

## 安装

前置要求：[Node.js](https://nodejs.org) ≥ 22（`node --version` 查看；本工具零运行时依赖）。

```bash
git clone https://github.com/qjy0128/sgen.git
cd sgen
npm link          # 全局安装 sgen 命令
sgen --help       # 打印用法说明即安装成功
```

### 更新

工具每天后台检查一次 GitHub main 分支上的新版本（比较 `package.json` 版本号，只读 HTTPS 请求，不碰你的 `.git`）；发现新版本时只在 stderr 提示一行，由你手动到仓库目录 `git pull` 更新——工具绝不自动修改你的代码。

禁用检查（任一即可）：

- 临时：`SGEN_NO_UPDATE_CHECK=1 sgen ...`
- 持久：`sgen config set update_check false`
- CI 环境（`CI` 为真值）自动跳过

检查状态、Key 轮换游标和最近 100 个视频任务的 `video_id → model` 映射存在 `~/.sgen/state.json`。状态使用文件锁与原子替换写入，多条 `sgen` 命令并发执行时不会互相覆盖。


## 获取 API Key（两家平台，约 5 分钟）

### 1. 商汤日日新 SenseNova（免费）

1. 打开 [platform.sensenova.cn](https://platform.sensenova.cn) 注册并登录
2. 进入控制台 → **管理中心 → API-Key 管理** → 创建 API Key
3. Key 以 `sk-` 开头，**只在创建时完整显示一次**，请立即复制保存
4. 免费额度：Token Plan 公测期**每模型 1500 次请求 / 5 小时**（说明见 [sensenova.cn/token-plan](https://www.sensenova.cn/token-plan)）

### 2. Agnes（图片/视频模型限免 $0）

1. 国际版控制台：[platform.agnes-ai.com](https://platform.agnes-ai.com)（默认）；中国版：[platform.agnes-ai.cn](https://platform.agnes-ai.cn)
2. 注册并登录后，在**开发者控制台**生成 API Key
3. 两版接口域名不同，但 **Key 目前通用**（官方未承诺长期保持）。工具默认走国际版域名，需要国内节点时用 `sgen config set agnes.region china` 一键切换

## 配置密钥

```bash
sgen config init          # 引导式创建配置（也支持管道：echo "sk-xxx" | sgen config init）
sgen config list          # 查看配置（Key 打码显示）
sgen config test          # 逐把 Key 连通性检查；任一失败则退出码 1
sgen config test --json   # 输出结构化检查结果
sgen config set agnes.region china   # Agnes 切换中国版（域名自动换 api.agnes-ai.cn）
```

配置文件 `~/.sgen/config.json`（**明文存 Key，只在你本机、不在仓库内，不会被 git 提交**）。工具会把 `~/.sgen/` 权限收紧为 `0700`、配置与状态文件收紧为 `0600`，仅当前用户可读写：

```json
{
  "providers": {
    "sensenova": { "api_keys": ["sk-第一把", "sk-第二把"] },
    "agnes": { "api_keys": ["ak-xxx"], "region": "international" }
  }
}
```

- 每家可配多把 Key，按序轮转使用（游标存 `~/.sgen/state.json`），撞 401/429 自动换下一把，且后续调用优先从好 Key 起步
- 环境变量兜底：`SENSENOVA_API_KEY` / `AGNES_API_KEY`
- 生成请求不会自动重试：连接中断时宁可报告“结果不确定”，也不冒险重复生成或重复扣费；401/403/429 的明确响应仍按 Key 池规则处理
- 单次 HTTP 调用超时默认 300 秒，可用 `SGEN_HTTP_TIMEOUT_MS` 覆写；视频 `--timeout` 是整个等待流程的硬上限
- `base_url` 可直接覆写（默认商汤 `https://token.sensenova.cn/v1`；Agnes 国际版 `https://apihub.agnes-ai.com/v1`、中国版 `https://api.agnes-ai.cn/v1`）
- Agnes 国际版与中国版接口域名不同；**Key 目前通用**（官方未承诺长期保持），切换区域只影响请求走哪个域名

配置完成后验证：

```bash
sgen config test            # 逐把 Key 连通性检查（✓ 连通 / ✗ 失败；任一失败返回 1）
sgen image "一张测试图"       # 真实生成一张（默认免费模型）
```

## 命令

### 生图 `sgen image <提示词>`

```bash
sgen image "一只戴宇航头盔的橘猫"                       # 默认商汤 u1.5-lite，落当前目录
sgen image "海报设计" --size 4K --out poster.png        # 指定尺寸与输出文件
sgen image "重新生成" --out poster.png --force          # 明确允许覆盖已有文件
sgen image "改成赛博朋克风" --image ./photo.png         # 图生图（商汤 edits 接口）
sgen image "合成一张" --image a.png --image b.png \
  --model agnes-image-2.1-flash --size 2K --ratio 16:9 # Agnes 多图合成
```

| 参数 | 说明 |
|---|---|
| `--model <名称>` | 模型（默认 `sensenova-u1.5-lite`；目录外模型会透传并提示无法判断是否收费） |
| `--size <尺寸>` | 档位（`2K`/`4K`、`1K`–`4K`）或精确像素 `1024x1024`，按模型限制校验 |
| `--ratio <比例>` | 宽高比，仅目录中标注支持的模型可用 |
| `--image <路径>` | 参考图，可重复多张（png/jpg/webp/gif，自动转 Base64，无需图床） |
| `--out <路径>` | 输出文件或目录（默认当前目录，命名 `sgen-时间戳-随机码.png`） |
| `--force` | 允许覆盖已经存在的 `--out` 文件；默认拒绝覆盖，并在调用远端前报错 |
| `--json` | 输出结构化 JSON；成功含 model/size/ratio/file/elapsed_ms，失败含 error/exit_code |

### 生视频 `sgen video <提示词>`

```bash
sgen video "日落海滩航拍" --seconds 8                   # 默认 agnes-video-2.5-flash，自动等出片
sgen video "让画面动起来" --first-frame a.png --last-frame b.png   # 首尾帧
sgen video "按 <Picture 1> 的风格" --ref-image a.png --ref-audio s.mp3  # 参考图+音频
sgen video "慢镜头" --model agnes-video-v2.0 --num-frames 241 --frame-rate 24  # 帧级控制，约 10 秒
sgen video "长任务" --no-wait                           # 立即返回 video_id，并在本地记录所用模型
```

模式自动推导：传 `--first-frame`/`--last-frame` → keyframe；传参考素材 → reference；都不传 → text。首尾帧与参考素材互斥。

| 参数 | 说明 |
|---|---|
| `--seconds <秒>` | 时长 4–12（默认 5），仅 2.5 系列 |
| `--size <档位>` | 2.5-flash 仅 `720P`；2.5 支持 `720P/960P/2K`；v2.0 支持 `480p/720p/1080p` |
| `--ratio <比例>` | 2.5 系列 6 档（21:9/16:9/4:3/1:1/3:4/9:16）；v2.0 5 档 |
| `--first-frame` / `--last-frame <路径>` | 首帧/尾帧图（可只用首帧） |
| `--ref-image <路径>` | 参考图，≤5 张，可重复 |
| `--ref-audio <路径>` | 参考音频（mp3/wav/m4a/aac/ogg/flac） |
| `--ref-video <路径>` | 参考视频（仅收费模型 `agnes-video-2.5`），`--video-start <秒>` 起始位置 |
| `--num-frames <数>` | v2.0 帧数，须 8n+1 且 ≤441（时长 = 帧数 ÷ 帧率） |
| `--frame-rate <数>` | v2.0 帧率 1–60 |
| `--no-wait` | 提交后立即返回 video_id |
| `--timeout <秒>` | 等待上限（默认 600） |
| `--out <路径>` | 输出文件或目录；下载采用流式临时文件，完成后原子落盘 |
| `--force` | 允许覆盖已经存在的 `--out` 文件 |
| `--json` | 输出结构化 JSON；失败时 JSON 同样写到 stdout，并用退出码表示错误类型 |

### 任务查询 `sgen status <video_id>`

```bash
sgen status vid-123            # 单次查询（进行中会显示进度百分比）
sgen status vid-123 --wait     # 继续等待到出片并自动下载
```

`sgen video` 创建任务后会立刻打印并保存任务号与模型。之后通常不必再填写 `--model`；若任务来自其他机器或状态文件已清理，可显式运行 `sgen status vid-123 --model agnes-video-v2.0 --wait`。`status` 同样支持 `--out`、`--force`、`--timeout` 和 `--json`。

### 其他

```bash
sgen models                    # 打印全部内置模型能力矩阵
sgen config init|set|list|test # 配置管理
```

**退出码**：`0` 成功 / `2` 本地用法或参数错误 / `1` 远端 API、网络或连通性检查错误。使用 `--json` 时，成功与失败都会在 stdout 给出可解析的结构化 JSON；进度和费用提醒仍只写 stderr。

## 模型能力矩阵（附录）

### 图片模型（4 个，当前全部免费）

| 模型 | 供应商 | 能力 | 尺寸 | 比例 | 计费 |
|---|---|---|---|---|---|
| `sensenova-u1.5-lite` ⭐默认 | 商汤 | 文生图 + 图生图 | `1K`/`2K`/`4K`/`auto` 或 `WxH`（宽高 512–4096 且为 32 的倍数、比例 ≤3:1） | `--ratio` 在本地换算为 WxH，不直接发给服务端 | 公测免费（1500 次/5 小时/模型） |
| `sensenova-u1-fast` | 商汤 | 仅文生图 | 仅 `1K`/`2K` 两档（**4K 会被拒**），比例上限 16:9、最高 9:21 | 10 档（见下表） | 公测免费（同上） |
| `agnes-image-2.1-flash` | Agnes | 文生图 + 图生图（前 3 张参考图免费） | `1K`/`2K`/`3K`/`4K`（兼容精确像素，非原生值会被归一化） | 8 档：1:1/3:4/4:3/16:9/9:16/2:3/3:2/21:9 | 限免 $0（刊例 1K $0.010 – 4K $0.024/张） |
| `agnes-image-2.0-flash` | Agnes | 文生图 + 图生图 | 精确像素写法（如 `1024x768`） | 无比例参数 | 限免 $0（刊例同上） |

`sensenova-u1-fast` 档位→精确像素对照（工具已内置自动换算）：

| 比例 | 1K | 2K |
|---|---|---|
| 1:1 | 1344x1344 | 2048x2048 |
| 16:9 | 1792x992 | 2752x1536 |
| 9:16 | 992x1792 | 1536x2752 |
| 2:3 | 1088x1632 | 1664x2496 |
| 3:2 | 1632x1088 | 2496x1664 |
| 3:4 | 1152x1536 | 1760x2368 |
| 4:3 | 1536x1152 | 2368x1760 |
| 4:5 | 1184x1472 | 1824x2272 |
| 5:4 | 1472x1184 | 2272x1824 |
| 9:21 | 864x2048 | 1344x3136 |

### 视频模型（3 个，全部 Agnes；商汤无开放视频 API）

| 模型 | 能力 | 分辨率 | 比例 | 时长 | 计费 |
|---|---|---|---|---|---|
| `agnes-video-2.5-flash` ⭐默认 | 文生视频 / 首帧 / 首尾帧 / 参考图≤5 / 参考音频 | **仅 720P** | 6 档：21:9→1680x720、16:9→1280x720、4:3→960x720、1:1→720x720、3:4→720x960、9:16→720x1280 | 4–12 秒（默认 5） | 限免 $0/秒（刊例 $0.025/秒） |
| `agnes-video-v2.0` | 文生视频 / 首帧 / 首尾帧 | 480p/720p/1080p（宽高由档位+比例推导，服务端归一化） | 5 档：16:9/9:16/1:1/4:3/3:4 | 帧数÷帧率：`num_frames` ≤441 且 8n+1，`frame_rate` 1–60（约 18 秒封顶） | 限免 $0/秒（刊例 $0.005/秒） |
| `agnes-video-2.5` ⚠️收费 | 文生视频 / 首尾帧 / 参考图 / 参考音频 / **参考视频** | 720P / 960P / 2K | 同 2.5-flash | 4–12 秒 | **按刊例收费**：720P $0.025、960P $0.040、2K $0.055 每秒；计费时长 = 输出秒数 + 输入视频秒数；第 6 张起参考图 $0.005/张 |

**计费安全**：启动时会校验默认模型必须标记为免费；收费目录项必须有价格规则并通过 `--model` 显式点名。`agnes-video-2.5` 执行前打印最低预估费用，输入视频时长另计。目录外模型会透传，但工具无法判断价格，因此会先给出明显警告。

## 在各个 AI 编程工具中使用（ZCode / Claude Code / Codex / Qoder / Trae / opencode / Antigravity / dsh / Kimi Code / mcode / WorkBuddy）

本机已完成全部接入（技能正本在 `~/.agents/skills/sgen/`，各工具按约定软链/写规则）。逐工具说明、mcode/WorkBuddy 的手动接入法、沙箱网络放行清单见 **[docs/agent-integration.md](docs/agent-integration.md)**。技能源文件改动后运行 `scripts/install-skill` 一键同步。

## 重要说明

- **免费政策有时效**（"公测/限免"为 2026-08 调研口径），以两家控制台为准；商汤另有"60000 积分/5 小时"表述并存，限流一律按 429 处理并自动换 Key。
- 商汤生图接口实际只接受 `auto` 或 `WxH` 精确像素——传 `2K`/`4K` 档位时工具会自动按比例换算成精确像素再发送（真机验证结论，与部分公告文档不符）。
- Agnes 视频状态查询接口有独立限流，查询过快返回 429——工具自动指数退避重试（3s→6s→…封顶 15s），无需处理。
- 创建视频任务后会立即把 `video_id` 和模型写入状态文件并打印恢复命令；即使按 Ctrl+C，中断后也能继续查询，不要重新提交。
- 商汤返回的图片 URL **24 小时失效**——工具已自动下载到本地，请以本地文件为准。
- Agnes 视频输出是否自带音频官方未明示，不承诺音频。
- 参考素材统一走本地文件 Base64 编码，无需图床；要求公开 URL 的场景不适用本工具用法。

## 开发与测试

```bash
npm test          # 黑盒测试：子进程跑 CLI + 本地假服务器（两家 API 全模拟）
npm run check     # 语法、目录/文档一致性、全部黑盒测试
scripts/smoke     # 真机冒烟：商汤生图 / Agnes 生图 / Agnes 生视频 各一次（需已配置 Key）
```

测试全部打在 CLI 进程边界上（`node --test`，零依赖），不访问真实网络。GitHub Actions 在 Node.js 22/24 上执行 `npm run check` 与打包预检，并在 PR 修改代码却未更新 `package.json` 版本号时失败。

## 排错

| 症状 | 处理 |
|---|---|
| `未找到 … API Key` | `sgen config init` 或设置对应环境变量 |
| `HTTP 401/403` | Key 无效（Agnes 两版 Key 目前通用；持续失败可切换 `agnes.region` 换域名重试）；`sgen config test` 逐把检查 |
| `全部 N 把 Key 均失败` | 限流/额度用尽：再加几把 Key，或稍后再试 |
| `--size/--ratio/--seconds 不被支持` | 错误信息会列出该模型可选值；`sgen models` 查全量 |
| 视频等待超时 | 报错里有包含正确 `--model` 的恢复命令；本机也会从 `state.json` 自动找回模型 |
| `输出文件已存在` | 改用新路径；只有确认覆盖时才加 `--force` |
| `生成请求未自动重试` | 请求结果可能不确定，先去平台控制台检查任务/额度，不要立刻重复提交 |
| 下载的 URL 失效 | 商汤 URL 24 小时过期；本地文件已自动保存 |
