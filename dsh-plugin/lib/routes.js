/**
 * dsh-sgen 的 HTTP 路由，供侧栏试验、读取状态、保存配置和读取作品文件。
 *
 * 路由都只允许本机同源访问：
 *   - GET /sgen/state    面板数据（配置摘要 + 模型目录 + 作品索引，不含 Key）
 *   - POST /sgen/config  保存面板配置，Key 仅用于本次写入
 *   - POST /sgen/generate 试验场生成，产物登记到历史
 *   - GET /sgen/file     ?id=<作品 id>，按索引返回文件，支持视频 Range
 *   - DELETE /sgen/file  ?id=<作品 id>，删除文件和对应索引
 *
 * @module dsh-sgen/routes
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isLoopbackHost } from './config.js'
import { readPanelState } from './history.js'
import { runPlayground } from './playground.js'
import { savePanelSettings, savePlaygroundDir } from './settings.js'

const MEDIA_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

function mediaTypeOf(file) {
  return MEDIA_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

function portOf(host, protocol) {
  const fallback = protocol === 'https:' ? '443' : '80'
  try {
    return new URL(`${protocol}//${String(host)}`).port || fallback
  } catch {
    return ''
  }
}

function createOriginCheck(webServer) {
  let allowed
  try {
    const origin = typeof webServer.getOrigin === 'function' ? webServer.getOrigin() : undefined
    if (origin) allowed = new URL(origin)
  } catch {
    // 监听尚未完成时退回“仅本机”判断
  }
  const allowedIsLoopback = allowed ? isLoopbackHost(allowed.host) : false
  const allowedPort = allowed ? portOf(allowed.host, allowed.protocol) : ''

  /** 本机回环地址允许 127.0.0.1 / localhost / [::1] 互相替换，但端口必须一致。 */
  function matchesHost(host, protocol) {
    if (!allowed) return isLoopbackHost(host)
    if (allowedIsLoopback && isLoopbackHost(host)) {
      return portOf(host, protocol) === allowedPort
    }
    return String(host).toLowerCase() === allowed.host.toLowerCase()
  }

  return function isSameOrigin(request) {
    const host = String(request.headers.host ?? '').toLowerCase()
    if (!host) return false
    if (!matchesHost(host, allowed ? allowed.protocol : 'http:')) return false
    const origin = request.headers.origin
    if (origin === undefined) return true
    try {
      const parsed = new URL(String(origin))
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
      if (allowed && parsed.protocol !== allowed.protocol) return false
      return matchesHost(parsed.host.toLowerCase(), parsed.protocol)
    } catch {
      return false
    }
  }
}

function parseRange(header, size) {
  const raw = String(header ?? '').trim()
  if (!raw) return { start: 0, end: size - 1, partial: false }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(raw)
  if (!match) return undefined
  const hasStart = match[1] !== ''
  const hasEnd = match[2] !== ''
  if (!hasStart && !hasEnd) return undefined
  let start
  let end
  if (hasStart) {
    start = Number(match[1])
    end = hasEnd ? Number(match[2]) : size - 1
  } else {
    // bytes=-N：最后 N 字节
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined
    start = Math.max(0, size - suffix)
    end = size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined
  if (start < 0 || start >= size || end < start) return undefined
  end = Math.min(end, size - 1)
  return { start, end, partial: true }
}

function registerFileRoute(webServer, history, isSameOrigin) {
  return webServer.register({
    kind: 'exact',
    path: '/sgen/file',
    handler: async (request, response) => {
      if (!['GET', 'HEAD', 'DELETE'].includes(request.method)) {
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '仅允许本机同源访问 sgen 作品文件' })
        return
      }
      let id
      try {
        const url = new URL(String(request.url ?? '/'), 'http://localhost')
        id = url.searchParams.get('id') ?? ''
      } catch {
        sendJson(response, 400, { ok: false, error: '无效的请求地址' })
        return
      }
      if (!id) {
        sendJson(response, 400, { ok: false, error: '缺少 id' })
        return
      }

      const item = await history.get(id)
      if (!item && request.method === 'DELETE') {
        sendJson(response, 200, { ok: true, id, already_deleted: true })
        return
      }
      if (!item) {
        sendJson(response, 404, { ok: false, error: '作品不存在或索引已清理' })
        return
      }
      if (request.method === 'DELETE') {
        try {
          await fsp.unlink(item.file)
        } catch (error) {
          if (error.code !== 'ENOENT') {
            sendJson(response, 500, { ok: false, error: `删除产物文件失败：${error.message}` })
            return
          }
        }
        await history.remove(id)
        sendJson(response, 200, { ok: true, id })
        return
      }
      let stat
      try {
        stat = await fsp.stat(item.file)
      } catch {
        sendJson(response, 404, { ok: false, error: '作品文件已不存在' })
        return
      }
      if (!stat.isFile()) {
        sendJson(response, 404, { ok: false, error: '作品路径不是普通文件' })
        return
      }
      if (stat.size === 0) {
        response.writeHead(200, {
          'content-type': mediaTypeOf(item.file),
          'content-length': 0,
          'accept-ranges': 'bytes',
          'cache-control': 'private, max-age=60',
          'x-content-type-options': 'nosniff',
        })
        response.end()
        return
      }

      const range = parseRange(request.headers.range, stat.size)
      if (!range) {
        response.writeHead(416, {
          'content-range': `bytes */${stat.size}`,
          'accept-ranges': 'bytes',
          'x-content-type-options': 'nosniff',
        })
        response.end()
        return
      }

      const headers = {
        'content-type': mediaTypeOf(item.file),
        'content-length': range.end - range.start + 1,
        'accept-ranges': 'bytes',
        'cache-control': 'private, max-age=60',
        'x-content-type-options': 'nosniff',
        ...(range.partial
          ? { 'content-range': `bytes ${range.start}-${range.end}/${stat.size}` }
          : {}),
      }
      response.writeHead(range.partial ? 206 : 200, headers)
      if (request.method === 'HEAD') {
        response.end()
        return
      }

      const stream = fs.createReadStream(item.file, { start: range.start, end: range.end })
      stream.on('error', () => {
        if (!response.headersSent) sendJson(response, 500, { ok: false, error: '读取作品文件失败' })
        else response.destroy()
      })
      response.on('close', () => stream.destroy())
      stream.pipe(response)
    },
  })
}

function registerStateRoute(webServer, config, history, isSameOrigin) {
  return webServer.register({
    kind: 'exact',
    path: '/sgen/state',
    handler: async (request, response) => {
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '仅允许本机同源访问 sgen 面板数据' })
        return
      }
      try {
        const data = await readPanelState(config, history)
        sendJson(response, 200, { ok: true, data })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error?.message || error) })
      }
    },
  })
}

async function readJsonBody(request, limit = 65_536) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) {
      throw Object.assign(new Error('请求内容过大'), { statusCode: 413 })
    }
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
  } catch {
    throw Object.assign(new Error('配置内容不是有效的 JSON'), { statusCode: 400 })
  }
}

function registerConfigRoute(webServer, config, history, isSameOrigin) {
  return webServer.register({
    kind: 'exact',
    path: '/sgen/config',
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '仅允许本机同源保存 sgen 配置' })
        return
      }
      try {
        const input = await readJsonBody(request)
        if (input && input.playground_dir !== undefined) await savePlaygroundDir(config, input.playground_dir)
        else await savePanelSettings(config, input)
        const data = await readPanelState(config, history)
        sendJson(response, 200, { ok: true, data })
      } catch (error) {
        const status = error.statusCode ?? (error.code === 2 ? 400 : 500)
        sendJson(response, status, { ok: false, error: String(error?.message || error) })
      }
    },
  })
}

function registerPlaygroundRoute(webServer, config, history, isSameOrigin) {
  return webServer.register({
    kind: 'exact',
    path: '/sgen/generate',
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        sendJson(response, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (!isSameOrigin(request)) {
        sendJson(response, 403, { ok: false, error: '仅允许本机同源使用 sgen 试验场' })
        return
      }
      const controller = new AbortController()
      const onClose = () => {
        if (!response.writableEnded) controller.abort()
      }
      response.once('close', onClose)
      try {
        const input = await readJsonBody(request, 48 * 1024 * 1024)
        const result = await runPlayground(config, history, input, { signal: controller.signal })
        sendJson(response, 200, { ok: true, ...result })
      } catch (error) {
        if (response.destroyed || response.writableEnded) return
        const status = error.statusCode ?? (error.code === 2 ? 400 : 500)
        sendJson(response, status, { ok: false, error: String(error?.message || error) })
      } finally {
        response.removeListener('close', onClose)
      }
    },
  })
}

/**
 * @param {any} ctx
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 * @param {ReturnType<import('./history.js').createHistoryStore>} history
 */
export function registerRoutes(ctx, config, history) {
  const mount = (webCtx) => {
    const webServer = webCtx.get?.('webServer') ?? webCtx.webServer
    if (!webServer || typeof webServer.register !== 'function') {
      ctx.logger?.warn?.('[sgen] 当前 profile 没有 webServer 服务，跳过作品面板路由')
      return undefined
    }
    const isSameOrigin = createOriginCheck(webServer)
    const disposers = [
      registerStateRoute(webServer, config, history, isSameOrigin),
      registerConfigRoute(webServer, config, history, isSameOrigin),
      registerPlaygroundRoute(webServer, config, history, isSameOrigin),
      registerFileRoute(webServer, history, isSameOrigin),
    ]
    webCtx.effect(
      () => () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            // 路由已被其他清理路径移除
          }
        }
      },
      'sgen: panel routes',
    )
    ctx.logger?.info?.('[sgen] 已注册面板路由 GET /sgen/state、POST /sgen/config、POST /sgen/generate、GET /sgen/file')
    return disposers
  }
  return typeof ctx.inject === 'function' ? ctx.inject(['webServer'], mount) : mount(ctx)
}
