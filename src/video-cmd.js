import { parseArgs } from './args.js'
import { usageErr } from './errors.js'
import { loadConfig } from './config.js'
import { findModel, DEFAULT_VIDEO_MODEL, providerForModelId, PROVIDERS } from './catalog.js'
import { validateVideoParams } from './validate.js'
import { createVideoTask, queryVideoTask } from './agnes.js'
import { callWithKeyPool } from './keys.js'
import { resolveOutPath, downloadTo } from './save.js'
import { imageToDataUri, audioToDataUri, videoToDataUri } from './media.js'

const POLL_INTERVAL_MS = 3000
const DEFAULT_TIMEOUT_S = 600

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const VIDEO_FLAGS = {
  flags: [
    'model',
    'seconds',
    'size',
    'ratio',
    'timeout',
    'out',
    'first-frame',
    'last-frame',
    'num-frames',
    'frame-rate',
    'video-start',
  ],
  booleans: ['json', 'no-wait'],
  multi: ['ref-image', 'ref-audio', 'ref-video'],
}

// 轮询直到 completed/failed；失败透出 API 错误原文，超时报错附恢复命令
// 状态查询接口有独立限流：429 时指数退避重试（3s→6s→…封顶 15s），不当作任务失败
async function waitUntilDone({ baseUrl, apiKey, videoId, model, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let backoffMs = 0
  for (;;) {
    let info
    try {
      info = await queryVideoTask({ baseUrl, apiKey, videoId, model })
    } catch (err) {
      if (err.status === 429 && Date.now() + 3000 <= deadline) {
        backoffMs = backoffMs ? Math.min(backoffMs * 2, 15000) : 3000
        console.error('  查询过快被限流，退避重试…')
        await sleep(backoffMs)
        continue
      }
      throw err
    }
    if (info.status === 'completed') return info
    if (info.status === 'failed') {
      const detail = info.error?.message ?? info.error ?? ''
      throw Object.assign(new Error(`Agnes 视频生成失败${detail ? '：' + detail : ''}`), { kind: 'api' })
    }
    const progress = info.progress !== undefined ? `（${info.progress}%）` : ''
    console.error(`  任务状态：${info.status ?? '未知'}${progress}`)

    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      throw Object.assign(
        new Error(
          `等待超时（${Math.round(timeoutMs / 1000)} 秒），任务仍在进行。video_id=${videoId}\n稍后运行：sgen status ${videoId} 继续等待并下载`,
        ),
        { kind: 'api' },
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function resolveAgnes(providerId) {
  const cfg = loadConfig()[providerId]
  if (!cfg.api_keys.length) {
    throw usageErr('未找到 Agnes API Key。请运行 sgen config init 配置，或设置环境变量 AGNES_API_KEY。')
  }
  if (cfg.region === 'china') {
    console.error(
      '提示：Agnes 中国版接口为 api.agnes-ai.cn（国际版为 apihub.agnes-ai.com）；两版 Key 目前通用，官方未承诺长期保持。',
    )
  }
  return cfg
}

// v2.0 的 width/height 由 档位+比例 推导（服务端会归一化到最近预设）
function v20Dimensions(size, ratio) {
  const shortSide = { '480p': 480, '720p': 720, '1080p': 1080 }[size] ?? 720
  const [rw, rh] = (ratio ?? '16:9').split(':').map(Number)
  const round16 = (n) => Math.round(n / 16) * 16
  return rw >= rh
    ? { width: round16((shortSide * rw) / rh), height: shortSide }
    : { width: shortSide, height: round16((shortSide * rh) / rw) }
}

export async function videoCmd(argv) {
  const args = parseArgs(argv, VIDEO_FLAGS)
  const prompt = args.positionals[0]
  if (!prompt) throw usageErr('缺少 <提示词>')

  const v = args.values
  const modelId = v.model ?? DEFAULT_VIDEO_MODEL
  const rec = findModel(modelId)

  // 模式推导：首/尾帧 → keyframe；参考素材 → reference；都没有 → text
  const hasKey = v['first-frame'] !== undefined || v['last-frame'] !== undefined
  const hasRef = v['ref-image'] || v['ref-audio'] || v['ref-video']
  if (hasKey && hasRef) {
    throw usageErr('首尾帧（--first-frame/--last-frame）与参考素材（--ref-image/--ref-audio/--ref-video）互斥，请二选一')
  }

  const providerId = rec ? rec.provider : providerForModelId(modelId)
  if (providerId === 'sensenova') {
    throw usageErr('商汤没有开放视频 API，sgen video 仅支持 Agnes 视频模型（sgen models 查看）')
  }

  let seconds = v.seconds
  let size = v.size
  let ratio = v.ratio
  let numFrames
  let frameRate

  if (rec) {
    if (rec.type !== 'video') throw usageErr(`${modelId} 是图片模型，请使用 sgen image`)
    const validated = validateVideoParams(rec, { seconds, size, ratio })
    seconds = validated.seconds
    size = validated.size
    ratio = validated.ratio

    const framesRule = rec.limits?.frames
    if (seconds !== undefined && !rec.limits?.seconds) {
      throw usageErr('--seconds 仅 2.5 系列支持；agnes-video-v2.0 请用 --num-frames 与 --frame-rate 控制时长')
    }
    if ((v['num-frames'] !== undefined || v['frame-rate'] !== undefined) && !framesRule) {
      throw usageErr('--num-frames/--frame-rate 仅 agnes-video-v2.0 支持')
    }
    if (v['num-frames'] !== undefined) {
      const n = Number(v['num-frames'])
      if (!Number.isInteger(n) || n < 9 || n > framesRule.max || (n - 1) % 8 !== 0) {
        throw usageErr(`--num-frames 须为 8n+1（如 121）且不超过 ${framesRule.max}`)
      }
      numFrames = n
    }
    if (v['frame-rate'] !== undefined) {
      const f = Number(v['frame-rate'])
      if (!Number.isInteger(f) || f < 1 || f > 60) throw usageErr('--frame-rate 可选 1–60')
      frameRate = f
    }
    if (v['ref-video'] && modelId !== 'agnes-video-2.5') {
      throw usageErr(`参考视频（--ref-video）仅收费模型 agnes-video-2.5 支持，${modelId} 不支持`)
    }
    if (v['ref-image'] && modelId === 'agnes-video-2.5-flash' && v['ref-image'].length > 5) {
      throw usageErr(`--ref-image 最多 5 张（当前 ${v['ref-image'].length} 张）`)
    }
  } else if (hasKey || hasRef) {
    throw usageErr(`未知模型 ${modelId} 无法校验媒体参数，请使用内置模型（sgen models 查看）`)
  }

  // 本地媒体编码（文件不存在/格式不支持在本地拦截）
  const firstUri = v['first-frame'] !== undefined ? imageToDataUri(v['first-frame']) : undefined
  const lastUri = v['last-frame'] !== undefined ? imageToDataUri(v['last-frame']) : undefined
  const refImages = v['ref-image']?.map(imageToDataUri)
  const refAudios = v['ref-audio']?.map(audioToDataUri)
  const videoStart = v['video-start'] !== undefined ? Number(v['video-start']) : 0
  const refVideos = v['ref-video']?.map((p) => ({
    url: videoToDataUri(p),
    start_seconds: videoStart,
    require_audio: false,
  }))

  // 计费保护：收费模型执行前打印预估费用
  if (rec?.pricing?.perSecond) {
    const sizeKey = size ?? rec.size.tiers[0]
    const price = rec.pricing.perSecond[sizeKey] ?? Object.values(rec.pricing.perSecond)[0]
    const secs = Number(seconds ?? rec.limits.seconds.default)
    console.error(
      `⚠ ${modelId} 为收费模型，预估费用 ≈ $${(secs * price).toFixed(3)}（输出 ${secs} 秒 × $${price}/秒；输入视频秒数按同价另计，第 6 张起参考图每张 $${rec.pricing.extraRefImageFrom6}）`,
    )
  }

  // 请求构造：v2.0 与 2.5 系列参数形态不同
  let payload
  if (rec?.id === 'agnes-video-v2.0') {
    const dims = v20Dimensions(size ?? rec.limits.frames.defaultSize, ratio ?? rec.limits.frames.defaultRatio)
    if (firstUri && lastUri) {
      payload = { model: modelId, prompt, extra_body: { mode: 'keyframes', image: [firstUri, lastUri] }, ...dims }
    } else {
      payload = { model: modelId, prompt, mode: 'ti2vid', ...dims }
      if (firstUri) payload.image = firstUri
    }
    if (numFrames !== undefined) payload.num_frames = numFrames
    if (frameRate !== undefined) payload.frame_rate = frameRate
  } else {
    const mode = hasKey ? 'keyframe' : hasRef ? 'reference' : 'text'
    payload = { model: modelId, prompt, mode }
    if (rec?.limits?.seconds) {
      payload.seconds = seconds !== undefined ? seconds : String(rec.limits.seconds.default)
      payload.size = size !== undefined ? size : rec.size.tiers[0]
    }
    if (ratio !== undefined) payload.aspect_ratio = ratio
    if (mode === 'keyframe') {
      payload.first_frame = firstUri
      if (lastUri) payload.last_frame = lastUri
    }
    if (mode === 'reference') {
      if (refImages) payload.images = refImages
      if (refAudios) payload.audios = refAudios
      if (refVideos) payload.videos = refVideos
    }
  }

  const cfg = await resolveAgnes('agnes')
  const noWait = Boolean(v['no-wait'])
  const timeoutMs = (Number(v.timeout) || DEFAULT_TIMEOUT_S) * 1000

  const startedAt = Date.now()
  console.error(`正在创建视频任务（${modelId}，${payload.mode ?? payload.extra_body?.mode ?? 'ti2vid'} 模式）…`)
  const result = await callWithKeyPool({
    providerId: 'agnes',
    label: PROVIDERS.agnes.label,
    keys: cfg.api_keys,
    fn: async (apiKey) => {
      const created = await createVideoTask({ baseUrl: cfg.base_url, apiKey, payload })
      if (noWait) return { videoId: created.videoId, status: created.status, url: null }
      const done = await waitUntilDone({
        baseUrl: cfg.base_url,
        apiKey,
        videoId: created.videoId,
        model: modelId,
        timeoutMs,
      })
      const url = done.metadata?.url ?? done.url ?? null
      if (!url) {
        throw Object.assign(
          new Error(`任务已完成但返回中没有视频 URL，原始响应：${JSON.stringify(done).slice(0, 400)}`),
          { kind: 'api', rotatable: false },
        )
      }
      return { videoId: created.videoId, status: 'completed', url }
    },
  })

  if (!result.url) {
    if (v.json) {
      console.log(
        JSON.stringify({
          ok: true,
          model: modelId,
          video_id: result.videoId,
          status: result.status,
          hint: `运行 sgen status ${result.videoId} --wait 继续等待并下载`,
        }),
      )
    } else {
      console.log(result.videoId)
      console.error(`任务已提交。稍后运行：sgen status ${result.videoId} --wait`)
    }
    return 0
  }

  const outPath = resolveOutPath(v.out, 'mp4')
  const file = await downloadTo(result.url, outPath)
  const elapsedMs = Date.now() - startedAt
  if (v.json) {
    console.log(JSON.stringify({ ok: true, model: modelId, video_id: result.videoId, file, elapsed_ms: elapsedMs }))
  } else {
    console.log(file)
  }
  return 0
}

export async function statusCmd(argv) {
  const args = parseArgs(argv, {
    flags: ['model', 'timeout', 'out'],
    booleans: ['json', 'wait'],
    multi: [],
  })
  const videoId = args.positionals[0]
  if (!videoId) throw usageErr('缺少 <video_id>（运行 sgen video --no-wait 可拿到任务号）')

  const modelId = args.values.model ?? DEFAULT_VIDEO_MODEL
  const cfg = await resolveAgnes('agnes')

  const timeoutMs = (Number(args.values.timeout) || DEFAULT_TIMEOUT_S) * 1000
  let info = await callWithKeyPool({
    providerId: 'agnes',
    label: PROVIDERS.agnes.label,
    keys: cfg.api_keys,
    fn: (apiKey) => queryVideoTask({ baseUrl: cfg.base_url, apiKey, videoId, model: modelId }),
  })

  if (info.status !== 'completed' && args.values.wait) {
    info = await callWithKeyPool({
      providerId: 'agnes',
      label: PROVIDERS.agnes.label,
      keys: cfg.api_keys,
      fn: (apiKey) =>
        waitUntilDone({ baseUrl: cfg.base_url, apiKey, videoId, model: modelId, timeoutMs }),
    })
  }

  if (info.status === 'failed') {
    const detail = info.error?.message ?? info.error ?? ''
    throw Object.assign(new Error(`Agnes 视频生成失败${detail ? '：' + detail : ''}`), { kind: 'api' })
  }

  if (info.status !== 'completed') {
    const progress = info.progress !== undefined ? `（${info.progress}%）` : ''
    if (args.values.json) {
      console.log(JSON.stringify({ ok: true, video_id: videoId, status: info.status, progress: info.progress ?? null }))
    } else {
      console.log(`视频任务 ${videoId}：${info.status}${progress}`)
      console.error(`继续等待：sgen status ${videoId} --wait`)
    }
    return 0
  }

  const url = info.metadata?.url ?? info.url
  if (!url) {
    throw Object.assign(
      new Error(`任务已完成但返回中没有视频 URL，原始响应：${JSON.stringify(info).slice(0, 400)}`),
      { kind: 'api' },
    )
  }
  const outPath = resolveOutPath(args.values.out, 'mp4')
  const file = await downloadTo(url, outPath)
  if (args.values.json) {
    console.log(JSON.stringify({ ok: true, video_id: videoId, status: 'completed', file }))
  } else {
    console.log(file)
  }
  return 0
}
