---
name: sgen
description: "本地生图/生视频命令行工具（商汤 SenseNova + Agnes 免费模型）。用户要生成图片、画图、海报、配图、插图、文生图、图生图、改图、多图合成，或生成视频、文生视频、图生视频（图片动起来）、首尾帧、参考图/音频生视频时，直接运行 sgen 命令，不要自己写 HTTP 调用。编程过程中需要任何视觉素材（占位图、演示图、动效演示）也用它。反触发：图片理解/看图问答（宿主自带能力）、界面截图，不用本工具。"
---

# sgen：生图与生视频

## 何时使用

用户（或任务）需要**产出**图片/视频文件时。命令输出就是本地文件路径，拿到即可继续用（嵌入文档、预览、加工）。

前置检查：`which sgen`。不存在则到 `~/Coding/imagegen` 运行 `npm link`；报缺 Key 则提示用户运行 `sgen config init`。

## 命令速查

```bash
# 生图（默认商汤 sensenova-u1.5-lite，免费、可 4K、无水印）
sgen image "一只戴宇航头盔的橘猫" --size 2K
sgen image "改成赛博朋克风" --image ./photo.png              # 图生图（本地路径，可多张 --image）
sgen image "海报" --model agnes-image-2.1-flash --ratio 16:9 --size 2K

# 生视频（默认 Agnes agnes-video-2.5-flash，免费、720P、自动等待出片）
sgen video "日落海滩航拍" --seconds 8
sgen video "图片动起来" --first-frame a.png                 # 首帧生视频（可加 --last-frame 做首尾帧）
sgen video "按 <Picture 1> 风格" --ref-image a.png --ref-audio s.mp3   # 参考素材（图≤5 张）
sgen video "慢镜头" --model agnes-video-v2.0 --num-frames 241 --frame-rate 24  # ≈10 秒
sgen video "长任务" --no-wait                                # 立即返回 video_id
sgen status <video_id> --wait                                # 回来续等并自动下载
```

通用：`--out <路径>` 指定输出；`--json` 结构化输出；`sgen models` 查全部模型与限制。
退出码：0 成功 / 2 参数或配置错 / 1 API 或网络错。

## 模型限制速查（非法参数会被本地拦截并列出可选值）

| 模型 | 用途 | 关键限制 | 价格 |
|---|---|---|---|
| `sensenova-u1.5-lite`（默认图） | 文/图生图 | 2K/4K 或 WxH（512–4096、32 倍数、≤3:1）；无 --ratio | 免费 |
| `sensenova-u1-fast` | 文生图 | 仅 1K/2K（4K 拒）；比例 16:9–9:21 共 10 档 | 免费 |
| `agnes-image-2.1-flash` | 文/图生图 | 1K–4K + 8 档比例 | 限免 $0 |
| `agnes-video-2.5-flash`（默认视频） | 文/首尾帧/参考生视频 | 仅 720P；4–12 秒；参考图≤5 | 限免 $0 |
| `agnes-video-v2.0` | 文/首尾帧生视频 | 480p–1080p；时长=帧数÷帧率（8n+1、≤441 帧） | 限免 $0 |
| `agnes-video-2.5` | 全功能含参考视频 | 720P/960P/2K | ⚠️ 收费，须显式点名，先出预估 |

## 常见报错自救

- `未找到 API Key` → 让用户跑 `sgen config init`（支持多把 Key 自动轮换）
- `HTTP 401/403` → Key 无效或 Agnes 国际版/中国版用混了（两版 Key 不通用）；`sgen config test` 逐把查
- `全部 N 把 Key 均失败` → 免费额度撞限流，等窗口刷新或加 Key
- `--xxx 不被支持` → 按报错里的可选值改参数，`sgen models` 查全量
- 视频等待超时 → 用报错里的 `sgen status <id> --wait` 恢复，不要重新提交浪费额度
- 商汤图片 URL 24 小时失效 → 工具已自动下载本地文件，用文件路径即可

## 注意

- 默认模型永远免费；唯一收费模型 `agnes-video-2.5` 必须显式 `--model` 点名且先打印预估费用。
- 参考图/音频/视频一律传**本地路径**（自动转 Base64），不要先上传图床。
- 首尾帧（--first-frame/--last-frame）与参考素材（--ref-image/--ref-audio/--ref-video）互斥。
- 详细参数与模型矩阵见 `~/Coding/imagegen/README.md`。
