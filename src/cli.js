import { resolveProviderConfig } from './config.js'
import { generateImage as sensenovaGenerate } from './sensenova.js'
import { generateImage as agnesGenerate } from './agnes.js'
import { resolveOutPath, downloadTo } from './save.js'
import { usageErr } from './errors.js'
import { renderModels, findModel, DEFAULT_IMAGE_MODEL, providerForModelId, PROVIDERS } from './catalog.js'
import { validateImageParams } from './validate.js'
import { imageToDataUri } from './media.js'
import { callWithKeyPool } from './keys.js'
import { configCmd } from './config-cmd.js'
import { videoCmd, statusCmd } from './video-cmd.js'
import { parseArgs } from './args.js'

const USAGE = `用法：sgen <命令> [参数]

命令：
  image <提示词> [选项]        生成图片（默认商汤 sensenova-u1.5-lite）
  video <提示词> [选项]        生成视频（默认 Agnes agnes-video-2.5-flash，自动等待出片）
  status <video_id> [选项]     查询/续等/下载视频任务
  models                       查看全部内置模型与能力限制
  config init|set|list|test    管理配置与 Key（首次用 init；set 示例：sgen config set agnes.region china，
                               全部可设项与含义运行 sgen config 查看）

image 选项：
  --model <名称>     指定模型（sgen models 查看可选值）
  --size <尺寸>      图片尺寸（如 2K、4K、1024x1024）
  --ratio <比例>     宽高比（仅部分模型支持，见 sgen models）
  --image <路径>     参考图（可重复传多张，做图生图/多图合成）
  --out <路径>       输出文件或目录（默认当前目录自动命名）
  --json             以 JSON 输出结果

video 选项：
  --model <名称>     指定模型（sgen models 查看可选值）
  --seconds <秒>     时长 4–12 秒（默认 5；仅 2.5 系列）
  --size <档位>      分辨率（2.5-flash 仅 720P；v2.0 支持 480p/720p/1080p）
  --ratio <比例>     2.5 系列 6 档；v2.0 支持 5 档
  --first-frame <路径> 首帧图（配 --last-frame 即首尾帧模式）
  --last-frame <路径>  尾帧图
  --ref-image <路径> 参考图（≤5 张，可重复）
  --ref-audio <路径> 参考音频（可重复）
  --ref-video <路径> 参考视频（仅收费模型 agnes-video-2.5）
  --video-start <秒> 参考视频的起始秒（配 --ref-video，默认 0）
  --num-frames <数>  v2.0 帧数（8n+1，≤441）
  --frame-rate <数>  v2.0 帧率（1–60）
  --no-wait          提交后立即返回 video_id，稍后用 sgen status 取片
  --timeout <秒>     等待上限（默认 600）
  --out <路径>       输出文件或目录（默认当前目录自动命名）
  --json             以 JSON 输出结果

status 选项：
  --model <名称>     任务所用模型（2.5 系列查询需带，默认 agnes-video-2.5-flash）
  --wait             任务未完成时继续等待直至出片
  --timeout <秒>     等待上限（默认 600）
  --out <路径>       输出文件或目录（默认当前目录自动命名）
  --json             以 JSON 输出结果

提示：--model / --size / --ratio 的可选值各模型不同，运行 sgen models 查看；
     填错会在本地直接报错并列出该模型支持的全部取值（不浪费 API 调用）。`

async function imageCmd(argv) {
  const args = parseArgs(argv, {
    flags: ['model', 'size', 'ratio', 'out'],
    booleans: ['json'],
    multi: ['image'],
  })
  const prompt = args.positionals[0]
  if (!prompt) throw usageErr(`缺少 <提示词>\n${USAGE}`)

  const modelId = args.values.model ?? DEFAULT_IMAGE_MODEL
  const rec = findModel(modelId)
  let size = args.values.size

  if (rec) {
    if (rec.type !== 'image') throw usageErr(`${modelId} 是视频模型，请使用 sgen video`)
    const v = validateImageParams(rec, { size, ratio: args.values.ratio })
    size = v.size
  } else if (args.values.ratio !== undefined) {
    throw usageErr(`未知模型 ${modelId} 无法校验 --ratio，请去掉该参数，或用 sgen models 查看内置模型`)
  }

  const providerId = rec ? rec.provider : providerForModelId(modelId)

  if (rec && args.values.image && !rec.caps.includes('图生图')) {
    throw usageErr(`${modelId} 不支持图生图（--image）。sgen models 可查看各模型能力`)
  }
  const images = args.values.image?.map(imageToDataUri)

  const cfg = resolveProviderConfig(providerId)

  const startedAt = Date.now()
  const model = modelId
  console.error(`正在生成图片（${model}）…`)
  const url = await callWithKeyPool({
    providerId,
    label: PROVIDERS[providerId].label,
    keys: cfg.api_keys,
    fn: (apiKey) =>
      providerId === 'agnes'
        ? agnesGenerate({
            baseUrl: cfg.base_url,
            apiKey,
            prompt,
            model,
            size,
            ratio: rec?.provider === 'agnes' ? args.values.ratio : undefined,
            images,
          })
        : sensenovaGenerate({
            baseUrl: cfg.base_url,
            apiKey,
            prompt,
            model,
            size,
            images,
          }),
  })
  const outPath = resolveOutPath(args.values.out, 'png')
  const file = await downloadTo(url, outPath)
  const elapsedMs = Date.now() - startedAt

  if (args.values.json) {
    console.log(JSON.stringify({ ok: true, model, file, elapsed_ms: elapsedMs }))
  } else {
    console.log(file)
  }
  return 0
}

export async function main(argv) {
  const [cmd, ...rest] = argv
  try {
    if (!cmd || cmd === '-h' || cmd === '--help') {
      console.log(USAGE)
      return 0
    }
    if (cmd === 'image') return await imageCmd(rest)
    if (cmd === 'video') return await videoCmd(rest)
    if (cmd === 'status') return await statusCmd(rest)
    if (cmd === 'models') {
      console.log(renderModels())
      return 0
    }
    if (cmd === 'config') return await configCmd(rest)
    throw usageErr(`未知命令：${cmd}\n${USAGE}`)
  } catch (err) {
    console.error(err.message || String(err))
    return err.kind === 'usage' ? 2 : 1
  }
}
