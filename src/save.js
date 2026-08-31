import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { httpTimeoutMs, networkErrText } from './api.js'
import { usageErr } from './errors.js'

function timestamp() {
  const d = new Date()
  const p = (n, width = 2) => String(n).padStart(width, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(), 3)}`
}

function autoName(dir, ext) {
  return path.join(dir, `sgen-${timestamp()}-${randomUUID().slice(0, 8)}.${ext}`)
}

function resolveOutPath(out, ext) {
  if (!out) return autoName(process.cwd(), ext)
  let isDir = out.endsWith(path.sep)
  try {
    isDir ||= fs.statSync(out).isDirectory()
  } catch {
    // 路径不存在：按写入目标是否以分隔符结尾判断
  }
  return isDir ? autoName(out, ext) : out
}

// 远端调用前预检输出目录和覆盖风险，避免生成完成后才发现无法保存
export function prepareOutPath(out, ext, { force = false } = {}) {
  const abs = path.resolve(resolveOutPath(out, ext))
  const dir = path.dirname(abs)
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
  } catch (err) {
    throw usageErr(`输出目录不可写：${dir}（${err.message}）`)
  }
  if (!force && fs.existsSync(abs)) {
    throw usageErr(`输出文件已存在：${abs}\n如确认覆盖，请加 --force`)
  }
  return abs
}

function safeUrl(url) {
  try {
    const parsed = new URL(url)
    return parsed.origin
  } catch {
    return '远端地址'
  }
}

function validateContentType(res, expectedKind) {
  if (!expectedKind) return
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!type || type === 'application/octet-stream' || type.startsWith(`${expectedKind}/`)) return
  throw Object.assign(new Error(`下载内容类型异常：期望 ${expectedKind}，实际 ${type}`), { kind: 'network' })
}

function publishTemp(tempPath, abs, force) {
  if (force) {
    fs.renameSync(tempPath, abs)
    return
  }
  try {
    fs.linkSync(tempPath, abs)
    fs.unlinkSync(tempPath)
  } catch (err) {
    if (err.code === 'EEXIST') throw usageErr(`输出文件已被其他进程创建：${abs}\n如确认覆盖，请加 --force`)
    throw err
  }
}

export async function downloadTo(url, outPath, { force = false, expectedKind } = {}) {
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(httpTimeoutMs()) })
  } catch (err) {
    throw Object.assign(new Error(`下载失败（${safeUrl(url)}）：${networkErrText(err)}`), { kind: 'network' })
  }
  if (!res.ok) throw Object.assign(new Error(`下载失败（HTTP ${res.status}）`), { kind: 'network' })
  validateContentType(res, expectedKind)
  if (!res.body) throw Object.assign(new Error('下载失败：响应中没有文件内容'), { kind: 'network' })

  const abs = path.resolve(outPath)
  const tempPath = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${randomUUID()}.part`)
  try {
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }))
    publishTemp(tempPath, abs, force)
  } catch (err) {
    if (err.kind) throw err
    throw Object.assign(new Error(`保存文件失败：${err.message}`), { kind: 'network' })
  } finally {
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // 已成功发布或临时文件未创建
    }
  }
  return abs
}
