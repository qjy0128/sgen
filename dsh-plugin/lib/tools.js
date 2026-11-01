/**
 * dsh-sgen 的模型面工具：参数整理、调用 CLI、结构化结果、作品索引。
 *
 * 工具只做三件事：
 *   1. 把模型给的参数翻译成 sgen 命令行；
 *   2. 把 CLI 的 --json 结果整理成稳定字段；
 *   3. 把生成的图片登记为 DSH 附件（如果 profile 挂载了 attachments 服务）。
 * 模型限制、价格校验、Key 轮换全部由 CLI 负责，插件不复制第二套规则。
 *
 * @module dsh-sgen/tools
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import { expandHome } from './config.js'
import { runSgen, runSgenJson } from './run.js'

const IMAGE_MEDIA_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const IMAGE_VALUE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
  properties: {
    attachmentId: { type: 'string' },
    mediaType: {
      type: 'string',
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    bytes: { type: 'integer' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    name: { type: 'string' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      required: ['width', 'height'],
      properties: {
        width: { type: 'integer' },
        height: { type: 'integer' },
      },
    },
  },
}

function outputObject(properties, required) {
  return { type: 'object', additionalProperties: false, properties, ...(required?.length ? { required } : {}) }
}

function params(properties, required) {
  return { type: 'object', properties, required, additionalProperties: false }
}

function imageRefFromValue(value) {
  return {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...(value.name ? { name: value.name } : {}),
    ...(value.originalDimensions
      ? { originalDimensions: { ...value.originalDimensions } }
      : {}),
  }
}

function imageValueFromRef(ref) {
  return {
    attachmentId: String(ref.attachmentId),
    mediaType: ref.mediaType,
    bytes: ref.bytes,
    width: ref.width,
    height: ref.height,
    ...(ref.name ? { name: ref.name } : {}),
    ...(ref.originalDimensions
      ? { originalDimensions: { ...ref.originalDimensions } }
      : {}),
  }
}

function sniffImageMediaType(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  const startsWith = (offset, expected) =>
    bytes.length >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte)
  if (startsWith(0, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png'
  if (startsWith(0, [255, 216, 255])) return 'image/jpeg'
  if (startsWith(0, [71, 73, 70, 56])) return 'image/gif'
  if (startsWith(0, [82, 73, 70, 70]) && startsWith(8, [87, 69, 66, 80])) return 'image/webp'
  return undefined
}

function truncate(value, max) {
  const text = String(value ?? '')
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text
}

function finiteNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function cleanWarnings(stderr) {
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /⚠|收费|提示|预估|新版本|结果不确定|限流|退避|已自动改用/.test(line))
  if (!lines.length) return undefined
  return truncate(lines.join('\n'), 1500)
}

/** 会话工作目录：优先插件配置的 defaultCwd，其次 Agent Session 的 cwd。 */
function sessionCwd(exec, config) {
  if (config.defaultCwd) return config.defaultCwd
  const fromAgent = exec?.agent?.session?.header?.cwd
  if (typeof fromAgent === 'string' && fromAgent.trim()) return fromAgent
  return process.cwd()
}

function resolveInputPath(value, cwd) {
  const text = expandHome(String(value ?? '').trim())
  if (!text) throw new Error('参考素材路径不能为空')
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(cwd, text)
}

function resolveOut(value) {
  const text = expandHome(String(value ?? '').trim())
  return text || undefined
}

function resolveOutputFile(value, cwd) {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('sgen 没有返回输出文件路径')
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(cwd, text)
}

function requirePrompt(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('prompt 不能为空')
  return value.trim()
}

function positiveNumber(value, name) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${name} 必须是正数`)
  return number
}

/**
 * 把生成结果登记成 DSH 图片附件。附件失败不影响生成本身：
 * 文件已经落盘，面板和后续工具仍能使用路径。
 */
async function attachImage(ctx, file) {
  const attachments = ctx.get('attachments')
  if (!attachments || typeof attachments.saveImage !== 'function') return undefined
  try {
    const data = await fsp.readFile(file)
    const limit = attachments.imageLimits?.maxImageBytes
    if (Number.isFinite(limit) && limit > 0 && data.byteLength > limit) {
      ctx.logger?.warn?.(`[sgen] 图片超过附件上限（${data.byteLength} > ${limit}），只返回本地路径`)
      return undefined
    }
    const mediaType =
      IMAGE_MEDIA_BY_EXT[path.extname(file).toLowerCase()] ?? sniffImageMediaType(data)
    if (!mediaType) return undefined
    const ref = await attachments.saveImage({
      data,
      mediaType,
      name: path.basename(file),
    })
    return imageValueFromRef(ref)
  } catch (error) {
    ctx.logger?.warn?.(`[sgen] 图片附件保存失败（仍保留本地文件）：${error.message}`)
    return undefined
  }
}

async function remember(ctx, history, entry) {
  try {
    await history.add(entry)
  } catch (error) {
    ctx.logger?.warn?.(`[sgen] 作品索引写入失败：${error.message}`)
  }
}

function assertOk(data, label) {
  if (!data || data.ok !== true) {
    const message = data?.error?.message ?? `${label} 返回了失败结果`
    throw new Error(String(message))
  }
}

function pickImageParams(data) {
  const value = {}
  if (typeof data.size === 'string' && data.size) value.size = data.size
  if (typeof data.ratio === 'string' && data.ratio) value.ratio = data.ratio
  const elapsed = finiteNumber(data.elapsed_ms)
  if (elapsed !== undefined) value.elapsed_ms = Math.round(elapsed)
  return value
}

function pickVideoParams(data) {
  const value = {}
  if (typeof data.mode === 'string' && data.mode) value.mode = data.mode
  const seconds = finiteNumber(data.seconds)
  if (seconds !== undefined) value.seconds = seconds
  if (typeof data.size === 'string' && data.size) value.size = data.size
  if (typeof data.ratio === 'string' && data.ratio) value.ratio = data.ratio
  return value
}

function imageSummary(value) {
  const lines = [`已生成图片：${value.file}`]
  const details = [`模型：${value.model}`]
  if (value.size) details.push(`尺寸：${value.size}`)
  if (value.ratio) details.push(`比例：${value.ratio}`)
  if (Number.isFinite(value.elapsed_ms)) details.push(`耗时：${(value.elapsed_ms / 1000).toFixed(1)}s`)
  lines.push(details.join(' · '))
  lines.push(`提示词：${truncate(value.prompt, 300)}`)
  if (value.warnings) lines.push(`提示：${value.warnings}`)
  return lines.join('\n')
}

function videoSummary(value) {
  if (value.file) {
    const details = [`模型：${value.model}`]
    if (value.mode) details.push(`模式：${value.mode}`)
    if (value.seconds) details.push(`时长：${value.seconds}s`)
    if (value.size) details.push(`分辨率：${value.size}`)
    if (value.ratio) details.push(`比例：${value.ratio}`)
    const lines = [`视频已生成：${value.file}`, details.join(' · '), `提示词：${truncate(value.prompt, 300)}`]
    if (value.warnings) lines.push(`提示：${value.warnings}`)
    return lines.join('\n')
  }
  const lines = [
    `视频任务已提交：${value.video_id}（${value.status ?? '已提交'}）`,
    `模型：${value.model}`,
  ]
  if (value.hint) lines.push(value.hint)
  if (value.warnings) lines.push(`提示：${value.warnings}`)
  return lines.join('\n')
}

function textTool({ name, description, parameters, output, run, presentCall, timeoutMs, concurrencySafe = false }) {
  return {
    name,
    description,
    parameters,
    output,
    timeoutMs,
    isConcurrencySafe: () => concurrencySafe,
    presentCall,
    async execute(args, exec) {
      return run(args && typeof args === 'object' ? args : {}, exec)
    },
  }
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 * @param {{ history: ReturnType<import('./history.js').createHistoryStore>, modelsCache: { text?: string, at: number } }} runtime
 */
export function registerTools(ctx, config, runtime) {
  const history = runtime.history
  const imageTimeout = Math.min(config.commandTimeoutMs, 900_000)

  ctx.tools.register(
    textTool({
      name: 'sgen_image',
      description:
        '用 SGeN 生成图片，结果保存为本地文件。默认走商汤免费模型 sensenova-u1.5-lite；' +
        '支持文生图、图生图和多图合成。模型限制、Key 轮换和下载都由 sgen 处理。',
      parameters: params(
        {
          prompt: { type: 'string', description: '图片提示词。' },
          model: {
            type: 'string',
            description: '模型 ID；默认 sensenova-u1.5-lite。用 sgen_models 查看全部模型与限制。',
          },
          size: {
            type: 'string',
            description: '尺寸档位（如 1K/2K/4K）或精确像素（如 1024x1024）；按模型限制校验。',
          },
          ratio: {
            type: 'string',
            description: '宽高比（如 16:9、1:1）；仅目录中标注支持的模型可用。',
          },
          images: {
            type: 'array',
            items: { type: 'string' },
            description: '参考图本地路径，可多张；相对路径按会话工作目录解析。',
          },
          out: {
            type: 'string',
            description: '输出文件或目录；相对路径按会话工作目录解析。默认当前目录自动命名。',
          },
          force: {
            type: 'boolean',
            description: '允许覆盖已存在的 --out 文件；默认拒绝覆盖。',
          },
        },
        ['prompt'],
      ),
      output: {
        schema: outputObject(
          {
            ok: { type: 'boolean' },
            file: { type: 'string' },
            model: { type: 'string' },
            prompt: { type: 'string' },
            size: { type: 'string' },
            ratio: { type: 'string' },
            elapsed_ms: { type: 'integer' },
            warnings: { type: 'string' },
            image: IMAGE_VALUE_SCHEMA,
          },
          ['ok', 'file', 'model', 'prompt'],
        ),
        render: (_args, value) => {
          const blocks = [{ type: 'text', text: imageSummary(value) }]
          if (value.image) blocks.push({ type: 'image', attachment: imageRefFromValue(value.image) })
          return blocks
        },
        presentationMeta: (_args, value) => ({ path: value.file }),
      },
      presentCall(args) {
        return {
          card: 'generic',
          title: `生成图片：${truncate(args.prompt, 50)}`,
          kind: 'other',
          rawInput: {
            prompt: args.prompt,
            ...(args.model ? { model: args.model } : {}),
            ...(args.size ? { size: args.size } : {}),
            ...(args.ratio ? { ratio: args.ratio } : {}),
          },
        }
      },
      timeoutMs: imageTimeout,
      async run(args, exec) {
        const prompt = requirePrompt(args.prompt)
        const cwd = sessionCwd(exec, config)
        const images = Array.isArray(args.images) ? args.images.filter((item) => typeof item === 'string' && item.trim()) : []
        if (args.images !== undefined && !Array.isArray(args.images)) throw new Error('images 必须是路径数组')

        const argv = ['image']
        if (args.model) argv.push('--model', String(args.model))
        if (args.size) argv.push('--size', String(args.size))
        if (args.ratio) argv.push('--ratio', String(args.ratio))
        for (const image of images) argv.push('--image', resolveInputPath(image, cwd))
        if (args.out) argv.push('--out', resolveOut(args.out))
        if (args.force === true) argv.push('--force')
        argv.push('--json')
        // 提示词放在 -- 之后，避免以 - 开头的提示词被当成参数。
        argv.push('--', prompt)

        const { data, stderr } = await runSgenJson(config, argv, {
          cwd,
          signal: exec.signal,
          timeoutMs: imageTimeout,
        })
        assertOk(data, 'sgen image')
        if (typeof data.file !== 'string' || !data.file) throw new Error('sgen image 没有返回输出文件路径')

        const value = {
          ok: true,
          file: resolveOutputFile(data.file, cwd),
          model: typeof data.model === 'string' && data.model ? data.model : '未知模型',
          prompt,
          ...pickImageParams(data),
        }
        const warnings = cleanWarnings(stderr)
        if (warnings) value.warnings = warnings
        const image = await attachImage(ctx, value.file)
        if (image) value.image = image
        await remember(ctx, history, {
          kind: 'image',
          file: value.file,
          name: path.basename(value.file),
          model: value.model,
          prompt,
          size: value.size,
          ratio: value.ratio,
          elapsed_ms: value.elapsed_ms,
          width: image?.width,
          height: image?.height,
        })
        return value
      },
    }),
  )

  ctx.tools.register(
    textTool({
      name: 'sgen_video',
      description:
        '用 SGeN 生成视频，默认 agnes-video-2.5-flash（限时免费、720P、4–12 秒）并自动等待出片下载。' +
        '支持文生视频、首帧/首尾帧和参考图/音频；内置模型全部当前免费。',
      parameters: params(
        {
          prompt: { type: 'string', description: '视频提示词。' },
          model: {
            type: 'string',
            description: '模型 ID；默认 agnes-video-2.5-flash。用 sgen_models 查看全部模型与限制。',
          },
          seconds: {
            type: 'number',
            description: '时长 4–12 秒；不传用模型默认值。',
          },
          size: {
            type: 'string',
            description: '分辨率档位，仅 720P。',
          },
          ratio: {
            type: 'string',
            description: '宽高比；可选值按模型不同，用 sgen_models 查看。',
          },
          first_frame: {
            type: 'string',
            description: '首帧图本地路径；可只给首帧，或与 last_frame 组成首尾帧。',
          },
          last_frame: {
            type: 'string',
            description: '尾帧图本地路径，必须与 first_frame 一起使用。',
          },
          ref_images: {
            type: 'array',
            items: { type: 'string' },
            description: '参考图本地路径，最多 5 张；与首尾帧互斥。',
          },
          ref_audios: {
            type: 'array',
            items: { type: 'string' },
            description: '参考音频本地路径（mp3/wav/m4a/aac/ogg/flac）；与首尾帧互斥。',
          },
          no_wait: {
            type: 'boolean',
            description: '提交后立即返回 video_id，不等待下载；稍后用 sgen_status 续等。',
          },
          timeout: {
            type: 'number',
            description: '等待出片的硬上限（秒），默认 600。',
          },
          out: {
            type: 'string',
            description: '输出文件或目录；相对路径按会话工作目录解析。默认当前目录自动命名。',
          },
          force: {
            type: 'boolean',
            description: '允许覆盖已存在的 --out 文件；默认拒绝覆盖。',
          },
        },
        ['prompt'],
      ),
      output: {
        schema: outputObject(
          {
            ok: { type: 'boolean' },
            prompt: { type: 'string' },
            model: { type: 'string' },
            file: { type: 'string' },
            video_id: { type: 'string' },
            status: { type: 'string' },
            mode: { type: 'string' },
            hint: { type: 'string' },
            seconds: { type: 'number' },
            size: { type: 'string' },
            ratio: { type: 'string' },
            elapsed_ms: { type: 'integer' },
            warnings: { type: 'string' },
          },
          ['ok', 'prompt', 'model'],
        ),
        render: (_args, value) => [{ type: 'text', text: videoSummary(value) }],
        presentationMeta: (_args, value) => (value.file ? { path: value.file } : { video_id: value.video_id }),
      },
      presentCall(args) {
        return {
          card: 'generic',
          title: args.no_wait
            ? `提交视频任务：${truncate(args.prompt, 50)}`
            : `生成视频：${truncate(args.prompt, 50)}`,
          kind: 'other',
          rawInput: {
            prompt: args.prompt,
            ...(args.model ? { model: args.model } : {}),
            ...(args.seconds ? { seconds: args.seconds } : {}),
            ...(args.size ? { size: args.size } : {}),
          },
        }
      },
      timeoutMs: config.commandTimeoutMs,
      async run(args, exec) {
        const prompt = requirePrompt(args.prompt)
        const cwd = sessionCwd(exec, config)
        const noWait = args.no_wait === true
        const timeoutSec = args.timeout === undefined ? undefined : positiveNumber(args.timeout, 'timeout')
        const toolTimeout = noWait
          ? Math.min(config.commandTimeoutMs, 180_000)
          : Math.min(
              config.commandTimeoutMs,
              Math.max(300_000, (timeoutSec ?? 600) * 1000 + 180_000),
            )

        const argv = ['video']
        if (args.model) argv.push('--model', String(args.model))
        if (args.seconds !== undefined) argv.push('--seconds', String(args.seconds))
        if (args.size) argv.push('--size', String(args.size))
        if (args.ratio) argv.push('--ratio', String(args.ratio))
        if (args.first_frame) argv.push('--first-frame', resolveInputPath(args.first_frame, cwd))
        if (args.last_frame) argv.push('--last-frame', resolveInputPath(args.last_frame, cwd))
        for (const item of asStringArray(args.ref_images, 'ref_images')) {
          argv.push('--ref-image', resolveInputPath(item, cwd))
        }
        for (const item of asStringArray(args.ref_audios, 'ref_audios')) {
          argv.push('--ref-audio', resolveInputPath(item, cwd))
        }
        if (noWait) argv.push('--no-wait')
        if (timeoutSec !== undefined) argv.push('--timeout', String(timeoutSec))
        if (args.out) argv.push('--out', resolveOut(args.out))
        if (args.force === true) argv.push('--force')
        argv.push('--json')
        argv.push('--', prompt)

        const { data, stderr } = await runSgenJson(config, argv, {
          cwd,
          signal: exec.signal,
          timeoutMs: toolTimeout,
        })
        assertOk(data, 'sgen video')

        const value = {
          ok: true,
          prompt,
          model: typeof data.model === 'string' && data.model ? data.model : '未知模型',
          ...pickVideoParams(data),
        }
        if (typeof data.video_id === 'string' && data.video_id) value.video_id = data.video_id
        if (typeof data.status === 'string' && data.status) value.status = data.status
        if (typeof data.hint === 'string' && data.hint) value.hint = data.hint
        const elapsed = finiteNumber(data.elapsed_ms)
        if (elapsed !== undefined) value.elapsed_ms = Math.round(elapsed)
        const warnings = cleanWarnings(stderr)
        if (warnings) value.warnings = warnings

        if (typeof data.file === 'string' && data.file) {
          value.file = resolveOutputFile(data.file, cwd)
          await remember(ctx, history, {
            kind: 'video',
            file: value.file,
            name: path.basename(value.file),
            model: value.model,
            prompt,
            size: value.size,
            ratio: value.ratio,
            seconds: value.seconds,
            elapsed_ms: value.elapsed_ms,
            video_id: value.video_id,
          })
        }
        return value
      },
    }),
  )

  ctx.tools.register(
    textTool({
      name: 'sgen_status',
      description:
        '查询 SGeN 视频任务。默认只查一次；wait=true 时继续等待出片并自动下载。' +
        '适合 sgen_video 用 no_wait 提交后回来取片，不要重新提交任务。',
      parameters: params(
        {
          video_id: { type: 'string', description: 'sgen_video 返回的 video_id。' },
          model: {
            type: 'string',
            description: '任务使用的模型；本机状态文件通常已记住，状态丢失时才需要填写。',
          },
          wait: { type: 'boolean', description: '任务未完成时继续等待直至出片并下载。' },
          timeout: { type: 'number', description: '等待上限（秒），默认 600。' },
          out: {
            type: 'string',
            description: '输出文件或目录；相对路径按会话工作目录解析。',
          },
          force: { type: 'boolean', description: '允许覆盖已存在的 --out 文件。' },
        },
        ['video_id'],
      ),
      output: {
        schema: outputObject(
          {
            ok: { type: 'boolean' },
            video_id: { type: 'string' },
            model: { type: 'string' },
            status: { type: 'string' },
            progress: { type: 'number' },
            file: { type: 'string' },
            warnings: { type: 'string' },
          },
          ['ok', 'video_id', 'model', 'status'],
        ),
        render: (_args, value) => {
          if (value.file) {
            return [{ type: 'text', text: `视频已下载：${value.file}\n模型：${value.model} · 任务：${value.video_id}` }]
          }
          const progress =
            Number.isFinite(value.progress) ? `（${value.progress}%）` : ''
          return [
            {
              type: 'text',
              text: `视频任务 ${value.video_id}：${value.status}${progress}\n模型：${value.model}\n继续等待：sgen_status { video_id: "${value.video_id}", wait: true }`,
            },
          ]
        },
        presentationMeta: (_args, value) => ({ video_id: value.video_id }),
      },
      presentCall(args) {
        return {
          card: 'generic',
          title: `查询视频任务：${truncate(args.video_id, 60)}`,
          kind: 'other',
          ...(args.wait ? { description: '等待出片并下载' } : {}),
        }
      },
      timeoutMs: config.commandTimeoutMs,
      async run(args, exec) {
        const videoId = String(args.video_id ?? '').trim()
        if (!videoId) throw new Error('video_id 不能为空')
        const cwd = sessionCwd(exec, config)
        const wait = args.wait === true
        const timeoutSec = args.timeout === undefined ? undefined : positiveNumber(args.timeout, 'timeout')
        const toolTimeout = wait
          ? Math.min(
              config.commandTimeoutMs,
              Math.max(300_000, (timeoutSec ?? 600) * 1000 + 180_000),
            )
          : Math.min(config.commandTimeoutMs, 120_000)

        const argv = ['status']
        if (args.model) argv.push('--model', String(args.model))
        if (wait) argv.push('--wait')
        if (timeoutSec !== undefined) argv.push('--timeout', String(timeoutSec))
        if (args.out) argv.push('--out', resolveOut(args.out))
        if (args.force === true) argv.push('--force')
        argv.push('--json')
        argv.push('--', videoId)

        const { data, stderr } = await runSgenJson(config, argv, {
          cwd,
          signal: exec.signal,
          timeoutMs: toolTimeout,
        })
        assertOk(data, 'sgen status')

        const value = {
          ok: true,
          video_id: typeof data.video_id === 'string' ? data.video_id : videoId,
          model: typeof data.model === 'string' && data.model ? data.model : '未知模型',
          status: typeof data.status === 'string' && data.status ? data.status : 'unknown',
        }
        const progress = finiteNumber(data.progress)
        if (progress !== undefined) value.progress = progress
        const warnings = cleanWarnings(stderr)
        if (warnings) value.warnings = warnings
        if (typeof data.file === 'string' && data.file) {
          value.file = resolveOutputFile(data.file, cwd)
          await remember(ctx, history, {
            kind: 'video',
            file: value.file,
            name: path.basename(value.file),
            model: value.model,
            prompt: '',
            elapsed_ms: undefined,
            video_id: value.video_id,
          })
        }
        return value
      },
    }),
  )

  ctx.tools.register(
    textTool({
      name: 'sgen_models',
      description:
        '查看 SGeN 内置的全部图片/视频模型、尺寸、比例、时长和计费限制。' +
        '不确定某个模型支持哪些参数时先调用它。',
      parameters: params({}, []),
      output: {
        schema: outputObject(
          {
            ok: { type: 'boolean' },
            text: { type: 'string' },
            cached: { type: 'boolean' },
          },
          ['ok', 'text'],
        ),
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      presentCall() {
        return { card: 'generic', title: 'SGeN 模型目录', kind: 'read' }
      },
      timeoutMs: Math.min(config.commandTimeoutMs, 60_000),
      concurrencySafe: true,
      async run(_args, exec) {
        const now = Date.now()
        if (runtime.modelsCache.text && now - runtime.modelsCache.at < 60_000) {
          return { ok: true, text: runtime.modelsCache.text, cached: true }
        }
        const result = await runSgen(config, ['models'], {
          cwd: sessionCwd(exec, config),
          signal: exec.signal,
          timeoutMs: Math.min(config.commandTimeoutMs, 60_000),
        })
        const text = result.stdout.trim() || result.stderr.trim()
        if (!text) throw new Error('sgen models 没有返回内容')
        runtime.modelsCache = { text, at: now }
        return { ok: true, text }
      },
    }),
  )

  ctx.tools.register(
    textTool({
      name: 'sgen_config',
      description:
        '查看 SGeN 配置或逐把检查 API Key 连通性。只读，不会修改配置；' +
        '设置 Key 请在终端运行 sgen config init 或 sgen config set。',
      parameters: params(
        {
          action: {
            type: 'string',
            enum: ['list', 'test'],
            description: 'list 查看配置（Key 打码）；test 逐把探测连通性（只请求 /models，不产生生成费用）。',
          },
        },
        ['action'],
      ),
      output: {
        schema: outputObject(
          {
            ok: { type: 'boolean' },
            action: { type: 'string' },
            text: { type: 'string' },
            results: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['provider', 'label', 'status', 'message'],
                properties: {
                  provider: { type: 'string' },
                  label: { type: 'string' },
                  status: { type: 'string' },
                  message: { type: 'string' },
                  key: { type: 'string' },
                  http_status: { type: 'integer' },
                },
              },
            },
          },
          ['ok', 'action', 'text'],
        ),
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      presentCall(args) {
        return {
          card: 'generic',
          title: args.action === 'test' ? '测试 SGeN Key 连通性' : '查看 SGeN 配置',
          kind: 'read',
        }
      },
      timeoutMs: Math.min(config.commandTimeoutMs, 300_000),
      concurrencySafe: true,
      async run(args, exec) {
        const action = args.action
        if (action !== 'list' && action !== 'test') throw new Error('action 只能是 list 或 test')
        const cwd = sessionCwd(exec, config)
        if (action === 'list') {
          const result = await runSgen(config, ['config', 'list'], {
            cwd,
            signal: exec.signal,
            timeoutMs: Math.min(config.commandTimeoutMs, 60_000),
          })
          const text = result.stdout.trim() || result.stderr.trim()
          return { ok: true, action, text }
        }

        const result = await runSgen(config, ['config', 'test', '--json'], {
          cwd,
          signal: exec.signal,
          timeoutMs: Math.min(config.commandTimeoutMs, 300_000),
          allowNonZero: true,
        })
        const data = parseConfigTest(result.stdout)
        if (!data) throw new Error(result.stderr.trim() || 'sgen config test 没有返回可解析的 JSON')
        const results = Array.isArray(data.results)
          ? data.results.map((item) => ({
              provider: String(item?.provider ?? 'unknown'),
              label: String(item?.label ?? item?.provider ?? 'unknown'),
              status: String(item?.status ?? 'unknown'),
              message: String(item?.message ?? ''),
              ...(typeof item?.key === 'string' ? { key: item.key } : {}),
              ...(Number.isFinite(Number(item?.http_status))
                ? { http_status: Number(item.http_status) }
                : {}),
            }))
          : []
        const text = results.length
          ? results
              .map((item) => `${item.label}${item.key ? ` ${item.key}` : ''}：${item.message}`)
              .join('\n')
          : '没有可检查的 Key；请先在终端运行 sgen config init。'
        return { ok: data.ok === true, action, text, results }
      },
    }),
  )
}

function asStringArray(value, name) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${name} 必须是路径数组`)
  return value.filter((item) => typeof item === 'string' && item.trim())
}

function parseConfigTest(stdout) {
  const raw = String(stdout ?? '').trim()
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    const first = raw.indexOf('{')
    const last = raw.lastIndexOf('}')
    if (first < 0 || last <= first) return undefined
    try {
      return JSON.parse(raw.slice(first, last + 1))
    } catch {
      return undefined
    }
  }
}
