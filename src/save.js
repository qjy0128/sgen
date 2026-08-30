import fs from 'node:fs'
import path from 'node:path'

function timestamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function autoName(dir, ext) {
  const prefix = `sgen-${timestamp()}-`
  let seq = 1
  while (fs.existsSync(path.join(dir, `${prefix}${seq}.${ext}`))) seq++
  return path.join(dir, `${prefix}${seq}.${ext}`)
}

// --out 可以是文件路径，也可以是目录（目录内自动命名）；不传则落当前目录
export function resolveOutPath(out, ext) {
  if (!out) return autoName(process.cwd(), ext)
  let isDir = out.endsWith(path.sep)
  try {
    isDir ||= fs.statSync(out).isDirectory()
  } catch {
    // 路径不存在：按写入目标是否以分隔符结尾判断
  }
  return isDir ? autoName(out, ext) : out
}

export async function downloadTo(url, outPath) {
  let res
  try {
    res = await fetch(url)
  } catch (err) {
    throw Object.assign(new Error(`下载失败（${url}）：${err.message}`), { kind: 'network' })
  }
  if (!res.ok) throw Object.assign(new Error(`下载失败（HTTP ${res.status}）`), { kind: 'network' })

  const buf = Buffer.from(await res.arrayBuffer())
  const abs = path.resolve(outPath)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, buf)
  return abs
}
