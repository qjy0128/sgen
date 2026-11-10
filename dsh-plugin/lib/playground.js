import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runSgenJson } from './run.js'

const IMAGE_EXTENSIONS = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_IMAGE_BYTES = 16 * 1024 * 1024

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

function text(value, name, maxLength = 200) {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') throw invalid(`${name} 必须是字符串`)
  const result = value.trim()
  if (result.length > maxLength) throw invalid(`${name} 过长`)
  return result
}

async function materializeImages(input) {
  if (input === undefined) return { dir: '', files: [] }
  if (!Array.isArray(input)) throw invalid('images 必须是图片数组')
  if (!input.length) return { dir: '', files: [] }
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'sgen-dsh-playground-'))
  const files = []
  try {
    for (let index = 0; index < input.length; index += 1) {
      const item = input[index]
      const data = item?.data_url
      if (typeof data !== 'string') throw invalid('参考图缺少 data_url')
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(data)
      if (!match) throw invalid('参考图只支持 PNG、JPEG、WebP 或 GIF')
      const bytes = Buffer.from(match[2], 'base64')
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw invalid('每张参考图不能超过 16 MiB')
      if (bytes.toString('base64') !== match[2]) throw invalid('参考图 Base64 无效')
      const file = path.join(dir, `${String(index + 1).padStart(2, '0')}.${IMAGE_EXTENSIONS[match[1]]}`)
      await fsp.writeFile(file, bytes, { mode: 0o600, flag: 'wx' })
      files.push(file)
    }
    return { dir, files }
  } catch (error) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw error
  }
}

export async function runPlayground(config, history, input, { signal } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('试验场请求必须是 JSON 对象')
  }
  const kind = text(input.kind, 'kind', 20)
  if (kind !== 'image' && kind !== 'video') throw invalid('kind 只能是 image 或 video')
  const prompt = text(input.prompt, 'prompt', 32_000)
  if (!prompt) throw invalid('提示词不能为空')
  const model = text(input.model, 'model')
  const size = text(input.size, 'size', 40)
  const ratio = text(input.ratio, 'ratio', 40)
  const images = await materializeImages(input.images)

  try {
    await fsp.mkdir(config.playgroundDir, { recursive: true, mode: 0o700 })
    const argv = [kind]
    if (model) argv.push('--model', model)
    if (size) argv.push('--size', size)
    if (ratio) argv.push('--ratio', ratio)
    if (kind === 'video' && input.seconds !== undefined && input.seconds !== '') {
      const seconds = Number(input.seconds)
      if (!Number.isFinite(seconds)) throw invalid('seconds 必须是数字')
      argv.push('--seconds', String(seconds))
    }
    for (const file of images.files) argv.push(kind === 'image' ? '--image' : '--ref-image', file)
    argv.push('--out', `${config.playgroundDir}${path.sep}`, '--json', '--', prompt)
    const { data } = await runSgenJson(config, argv, {
      cwd: config.playgroundDir,
      signal,
      timeoutMs: kind === 'image' ? Math.min(config.commandTimeoutMs, 900_000) : config.commandTimeoutMs,
    })
    if (!data || data.ok !== true || typeof data.file !== 'string' || !data.file) {
      throw new Error(data?.error?.message || '生成失败：SGeN 没有返回产物文件')
    }
    const file = path.resolve(config.playgroundDir, data.file)
    const item = await history.add({
      kind,
      source: 'playground',
      file,
      name: path.basename(file),
      model: typeof data.model === 'string' && data.model ? data.model : model || '未知模型',
      prompt,
      size: typeof data.size === 'string' ? data.size : size,
      ratio: typeof data.ratio === 'string' ? data.ratio : ratio,
      seconds: Number.isFinite(Number(data.seconds)) ? Number(data.seconds) : undefined,
      elapsed_ms: Number.isFinite(Number(data.elapsed_ms)) ? Number(data.elapsed_ms) : undefined,
      video_id: typeof data.video_id === 'string' ? data.video_id : undefined,
    })
    return { item }
  } finally {
    if (images.dir) await fsp.rm(images.dir, { recursive: true, force: true })
  }
}
