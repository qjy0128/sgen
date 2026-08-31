import { parseArgs } from './args.js'
import { usageErr } from './errors.js'
import { resolveProviderConfig } from './config.js'
import { findModel, DEFAULT_VIDEO_MODEL, providerForModelId, PROVIDERS } from './catalog.js'
import { createVideoTask, queryVideoTask } from './agnes.js'
import { callWithKeyPool, fingerprintKey } from './keys.js'
import { prepareOutPath, downloadTo } from './save.js'
import { buildVideoPlan } from './video-plan.js'
import { rememberVideoTask, findVideoTask } from './state.js'
import { httpTimeoutMs } from './api.js'

const POLL_INTERVAL_MS = 3000
const DEFAULT_TIMEOUT_S = 600

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseTimeoutMs(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_S * 1000
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) throw usageErr(`--timeout 须为正数秒（当前：${value}）`)
  return n * 1000
}

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
  booleans: ['json', 'no-wait', 'force'],
  multi: ['ref-image', 'ref-audio', 'ref-video'],
}

function recoveryCommand(videoId, model) {
  return `sgen status ${videoId} --model ${model} --wait`
}

function timeoutError(timeoutMs, videoId, model) {
  return Object.assign(
    new Error(
      `等待超时（${Math.round(timeoutMs / 1000)} 秒），任务仍在进行。video_id=${videoId}\n稍后运行：${recoveryCommand(videoId, model)} 继续等待并下载`,
    ),
    { kind: 'api' },
  )
}

async function waitUntilDone({ baseUrl, apiKey, videoId, model, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let backoffMs = 0
  for (;;) {
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) throw timeoutError(timeoutMs, videoId, model)

    let info
    try {
      info = await queryVideoTask({
        baseUrl,
        apiKey,
        videoId,
        model,
        timeoutMs: Math.max(1, Math.min(httpTimeoutMs(), remainingMs)),
      })
    } catch (err) {
      if (err.status === 429) {
        backoffMs = backoffMs ? Math.min(backoffMs * 2, 15000) : 3000
        const delay = Math.min(backoffMs, deadline - Date.now())
        if (delay <= 0) throw timeoutError(timeoutMs, videoId, model)
        console.error('  查询过快被限流，退避重试…')
        await sleep(delay)
        continue
      }
      if (Date.now() >= deadline) throw timeoutError(timeoutMs, videoId, model)
      throw err
    }
    if (info.status === 'completed') return info
    if (info.status === 'failed') {
      const detail = info.error?.message ?? info.error ?? ''
      throw Object.assign(new Error(`Agnes 视频生成失败${detail ? '：' + detail : ''}`), { kind: 'api' })
    }
    const progress = info.progress !== undefined ? `（${info.progress}%）` : ''
    console.error(`  任务状态：${info.status ?? '未知'}${progress}`)

    const delay = Math.min(POLL_INTERVAL_MS, deadline - Date.now())
    if (delay <= 0) throw timeoutError(timeoutMs, videoId, model)
    await sleep(delay)
  }
}

function requireSinglePositional(positionals, label) {
  if (!positionals[0]) throw usageErr(`缺少 <${label}>`)
  if (positionals.length > 1) throw usageErr(`多余参数：${positionals.slice(1).join(' ')}（包含空格的内容请用引号包住）`)
  return positionals[0]
}

export async function videoCmd(argv) {
  const args = parseArgs(argv, VIDEO_FLAGS)
  const prompt = requireSinglePositional(args.positionals, '提示词')
  const values = args.values
  const modelId = values.model ?? DEFAULT_VIDEO_MODEL
  const plan = buildVideoPlan({ modelId, prompt, values, explicitlySelected: values.model !== undefined })
  if (plan.providerId !== 'agnes') {
    throw usageErr('商汤没有开放视频 API，sgen video 仅支持 Agnes 视频模型（sgen models 查看）')
  }

  const noWait = Boolean(values['no-wait'])
  const force = Boolean(values.force)
  const outPath = noWait ? null : prepareOutPath(values.out, 'mp4', { force })
  const timeoutMs = parseTimeoutMs(values.timeout)
  const cfg = resolveProviderConfig('agnes')
  if (plan.warning) console.error(plan.warning)

  const startedAt = Date.now()
  console.error(`正在创建视频任务（${modelId}，${plan.mode} 模式）…`)
  const result = await callWithKeyPool({
    providerId: 'agnes',
    label: PROVIDERS.agnes.label,
    keys: cfg.api_keys,
    fn: async (apiKey) => {
      const created = await createVideoTask({ baseUrl: cfg.base_url, apiKey, payload: plan.payload })
      rememberVideoTask(created.videoId, modelId, fingerprintKey(apiKey))
      console.error(`任务已创建：video_id=${created.videoId}；中断后可运行：${recoveryCommand(created.videoId, modelId)}`)
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
    const hint = `运行 ${recoveryCommand(result.videoId, modelId)} 继续等待并下载`
    if (values.json) {
      console.log(
        JSON.stringify({
          ok: true,
          model: modelId,
          video_id: result.videoId,
          status: result.status,
          mode: plan.mode,
          ...plan.normalized,
          hint,
        }),
      )
    } else {
      console.log(result.videoId)
      console.error(`任务已提交。${hint}`)
    }
    return 0
  }

  const file = await downloadTo(result.url, outPath, { force, expectedKind: 'video' })
  const elapsedMs = Date.now() - startedAt
  const output = {
    ok: true,
    model: modelId,
    video_id: result.videoId,
    mode: plan.mode,
    file,
    elapsed_ms: elapsedMs,
    ...plan.normalized,
  }
  if (values.json) console.log(JSON.stringify(output))
  else console.log(file)
  return 0
}

function resolveStatusContext(videoId, explicitModel) {
  const task = findVideoTask(videoId)
  const modelId = explicitModel ?? task?.model ?? DEFAULT_VIDEO_MODEL
  const known = findModel(modelId)
  if (known && known.type !== 'video') throw usageErr(`${modelId} 是图片模型，不能用于查询视频任务`)
  const providerId = known?.provider ?? providerForModelId(modelId)
  if (providerId !== 'agnes') throw usageErr('视频任务查询仅支持 Agnes 模型')
  return { modelId, task }
}

export async function statusCmd(argv) {
  const args = parseArgs(argv, {
    flags: ['model', 'timeout', 'out'],
    booleans: ['json', 'wait', 'force'],
    multi: [],
  })
  const videoId = requireSinglePositional(args.positionals, 'video_id')
  const { modelId, task } = resolveStatusContext(videoId, args.values.model)
  if (args.values.model) rememberVideoTask(videoId, modelId)
  const cfg = resolveProviderConfig('agnes')
  const preferredKey = task?.key_fingerprint
    ? cfg.api_keys.find((key) => fingerprintKey(key) === task.key_fingerprint)
    : undefined
  const timeoutMs = parseTimeoutMs(args.values.timeout)

  let info
  if (args.values.wait) {
    const force = Boolean(args.values.force)
    const outPath = prepareOutPath(args.values.out, 'mp4', { force })
    info = await callWithKeyPool({
      providerId: 'agnes',
      label: PROVIDERS.agnes.label,
      keys: cfg.api_keys,
      preferredKey,
      fn: (apiKey) => waitUntilDone({ baseUrl: cfg.base_url, apiKey, videoId, model: modelId, timeoutMs }),
    })
    const url = info.metadata?.url ?? info.url
    if (!url) {
      throw Object.assign(
        new Error(`任务已完成但返回中没有视频 URL，原始响应：${JSON.stringify(info).slice(0, 400)}`),
        { kind: 'api' },
      )
    }
    const file = await downloadTo(url, outPath, { force, expectedKind: 'video' })
    if (args.values.json) console.log(JSON.stringify({ ok: true, model: modelId, video_id: videoId, status: 'completed', file }))
    else console.log(file)
    return 0
  }

  info = await callWithKeyPool({
    providerId: 'agnes',
    label: PROVIDERS.agnes.label,
    keys: cfg.api_keys,
    preferredKey,
    fn: (apiKey) => queryVideoTask({ baseUrl: cfg.base_url, apiKey, videoId, model: modelId }),
  })
  if (info.status === 'failed') {
    const detail = info.error?.message ?? info.error ?? ''
    throw Object.assign(new Error(`Agnes 视频生成失败${detail ? '：' + detail : ''}`), { kind: 'api' })
  }
  if (info.status !== 'completed') {
    const progress = info.progress !== undefined ? `（${info.progress}%）` : ''
    if (args.values.json) {
      console.log(JSON.stringify({ ok: true, model: modelId, video_id: videoId, status: info.status, progress: info.progress ?? null }))
    } else {
      console.log(`视频任务 ${videoId}：${info.status}${progress}`)
      console.error(`继续等待：${recoveryCommand(videoId, modelId)}`)
    }
    return 0
  }

  const force = Boolean(args.values.force)
  const outPath = prepareOutPath(args.values.out, 'mp4', { force })
  const url = info.metadata?.url ?? info.url
  if (!url) throw Object.assign(new Error('任务已完成但返回中没有视频 URL'), { kind: 'api' })
  const file = await downloadTo(url, outPath, { force, expectedKind: 'video' })
  if (args.values.json) console.log(JSON.stringify({ ok: true, model: modelId, video_id: videoId, status: 'completed', file }))
  else console.log(file)
  return 0
}
