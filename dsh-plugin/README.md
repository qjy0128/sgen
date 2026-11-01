# dsh-sgen

[SGeN](../README.md) 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件。

它把 SGeN 的生图/生视频能力接进 DSH：

- **5 个原生工具**：`sgen_image`、`sgen_video`、`sgen_status`、`sgen_models`、`sgen_config`；
- **`sgen` 技能**：在会话技能目录中注册，触发词与仓库里的技能一致；
- **作品面板**：侧栏新增 `sgen` 图标，展示本机最近生成的图片/视频、Key 配置概览，并可直接打开文件；
- **零重复规则**：模型能力、尺寸/比例/时长限制、Key 轮换、价格校验全部由仓库里的 `sgen` CLI 负责，插件不维护第二套目录。

## 安装

插件以 DSH bundle 形式发布（`dsh.bundle.patch` 指向 `cordis.patch.yml`）。在 DSH 里用插件管理器安装本地路径：

```text
plugin_manager install_bundle /Users/qjy0128/Coding/sgen/dsh-plugin
```

安装后 bundle 会追加到 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`，
`cordis.patch.yml` 的 `insert` 行会挂载 `sgen` 插件。

安装后：

1. 新会话的工具列表出现 `sgen_*`；
2. 会话技能目录出现 `sgen`；
3. 侧栏出现 `sgen` 作品面板（新安装的 bundle 可能需要刷新一次页面）。

> 安装/卸载会修改 `~/.dsh/profiles/desktop` 下的 manifest 与 patch，需要 DSH 的
> danger-full-access 或一次显式批准。宿主代码在 DSH 进程内运行，不在工作区沙箱里。

### 手动安装（插件管理器不可用时）

编辑 `~/.dsh/profiles/desktop/package.json`：

```json
{
  "dependencies": {
    "dsh-sgen": "link:/Users/qjy0128/Coding/sgen/dsh-plugin"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-sgen"
      ]
    }
  }
}
```

然后在 profile 目录安装并重启 DSH（pnpm 路径以本机安装版本为准）：

```bash
cd ~/.dsh/profiles/desktop
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/bin/node" \
  "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/pnpm/bin/pnpm.cjs" install
```

## 配置

配置写在 bundle 的 `cordis.patch.yml` 里，也可以在用户 patch 层按行覆盖：

```yaml
- id: sgen
  config:
    sgenRoot: /Users/qjy0128/Coding/sgen
    historyFile: /Users/qjy0128/.sgen/dsh-gallery.json
    updateCheck: false
```

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `sgenRoot` | 从插件位置向上推导 | SGeN 仓库根目录，必须包含 `bin/sgen.js`、`src/catalog.js` |
| `sgenBin` | 空 | 可选的 `sgen` 可执行文件或 JS 入口；空表示用 Node 跑 `<sgenRoot>/bin/sgen.js` |
| `nodePath` | 宿主 Node / Electron | 运行 CLI 的 Node 可执行文件；Electron 宿主会自动加 `ELECTRON_RUN_AS_NODE=1` |
| `historyFile` | `~/.sgen/dsh-gallery.json` | 作品索引路径（只存路径和元数据，不复制文件） |
| `maxHistory` | `100` | 面板保留的最大作品数（1–1000） |
| `updateCheck` | `false` | 插件发起的 CLI 调用是否做每日更新检查；默认关闭以保持工具调用自包含（命令行 `sgen` 仍按自己的配置检查） |
| `defaultCwd` | 空 | 固定生成目录；空表示使用当前会话的工作目录 |
| `commandTimeoutMs` | `1800000` | 单次 CLI 调用的硬上限（毫秒） |
| `env` | `{}` | 额外传给 CLI 的环境变量（不要在这里写 API Key） |

API Key 仍由 SGeN 自己管理，默认放在 `~/.sgen/config.json`，权限 `0600`。插件只读取
**数量、区域和接口域名**用于面板展示，绝不把 Key 原文写进工具结果、作品索引或面板数据。

## 工具

| 工具 | 用途 |
| --- | --- |
| `sgen_image` | 文生图、图生图、多图合成；默认 `sensenova-u1.5-lite`，可选 `agnes-image-2.5-flash` |
| `sgen_video` | 文生视频、首帧/首尾帧、参考图/音频；默认 `agnes-video-2.5-flash` |
| `sgen_status` | 查询/续等/下载视频任务，不重新提交 |
| `sgen_models` | 查看全部免费模型与限制（文本，60 秒缓存） |
| `sgen_config` | `list` 查看配置（Key 打码）；`test` 逐把测试连通性 |

参数名和 SGeN 命令行一一对应：`model`、`size`、`ratio`、`images`、`first_frame`、
`last_frame`、`ref_images`、`ref_audios`、`seconds`、`no_wait`、`timeout`、`out`、`force`。相对路径按当前会话的工作目录解析。

工具返回结构化 JSON；生图成功且 profile 挂载了 `attachments` 服务时，工具结果还会带一张
可显示的图片附件。视频没有附件形态，返回本地文件路径，面板和后续工具都能直接使用。

## 技能

插件在 `ctx.skills` 上注册运行时技能 `sgen`：

- 名称/描述取自 `skill/sgen/SKILL.md` 的 frontmatter；
- 正文 = “DSH 原生工具优先”的映射 + 仓库里的原始技能正文；
- 不依赖 `skill-filesystem`，即使本地技能目录没有配置也能用；
- 修改 `skill/sgen/SKILL.md` 后重启 DSH 生效（运行时技能在插件加载时读取）。

如果本机已经装了用户级 `sgen` 技能（`~/.agents/skills/sgen/`），DSH 会优先采用用户技能，
插件运行时技能只作为没有用户技能时的兜底；原生工具不受影响，仍由工具描述直接引导。

## 作品面板

宿主半边注册两条只读路由：

- `GET /sgen/state`：配置摘要 + 最近作品索引（不含 Key）；
- `GET /sgen/file?id=<id>`：按索引返回作品文件，支持视频 `Range` 请求。

两条路由都只允许本机同源访问。面板每 10 秒刷新一次，支持“全部 / 图片 / 视频”筛选，
图片直接在卡片里预览，视频可播放，文件可在新标签页打开。

## 安全边界

- 生成请求由 `sgen` CLI 发往商汤/Agnes；插件本身不直接访问这两家 API。
- 参考素材按本地路径传给 CLI，CLI 自动转 Base64；插件不额外上传。
- 内置模型全部当前免费；已退役的 `agnes-video-v2.0` 和收费的 `agnes-video-2.5` 会被 CLI 在本地拦截。
- 作品索引只记录绝对路径、模型、提示词摘要和尺寸，不复制文件、不记录 Key。
- 面板路由仅本机同源；`/sgen/file` 只返回索引里登记过的文件。

## 开发与测试

```bash
cd dsh-plugin
npm test        # 语法检查 + 假 CLI 黑盒测试（不访问真实 API）
```

测试覆盖：工具注册、生图/生视频/任务查询的参数拼装、JSON 错误、作品索引去重、
配置连通性结果、技能注册和面板路由。

## 卸载

在 DSH 插件管理器里移除 `dsh-sgen` bundle，或从 profile 的 `package.json`
删掉依赖与 `dsh.profile.bundles` 里的条目后重新安装依赖。作品索引与生成的文件不会自动删除。
