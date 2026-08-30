import { startServer, readBody } from './server.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

// 模拟商汤的假服务器：记录请求，按 Key 鉴权，成功返回图片 URL
// keys: 接受的 Key 列表（默认 ['sk-test']）；reject: { key: 状态码 } 命中即返回该错误状态
// generations = 文生图，edits = 图生图（参考图在 body.images）
export async function fakeSensenova(t, { key, keys, reject = {} } = {}) {
  const accepted = keys ?? (key ? [key] : ['sk-test'])
  const calls = []
  const { server, url } = await startServer(async (req, res) => {
    if (
      req.method === 'POST' &&
      (req.url === '/v1/images/generations' || req.url === '/v1/images/edits')
    ) {
      const body = await readBody(req)
      const presented = req.headers.authorization?.replace(/^Bearer /, '')
      calls.push({ auth: req.headers.authorization, body, path: req.url })
      const rejectStatus = reject[presented]
      if (rejectStatus) {
        res.writeHead(rejectStatus, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `rejected ${presented} with ${rejectStatus}` } }))
        return
      }
      if (!accepted.includes(presented)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Authorization Not Found' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ url: `${url}/img.png` }] }))
      return
    }
    if (req.url === '/img.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG_BYTES)
      return
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      // config test 的连通性探针：好 Key 200，坏 Key 401
      const presented = req.headers.authorization?.replace(/^Bearer /, '')
      if (!accepted.includes(presented)) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Authorization Not Found' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [] }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  t.after(() => server.close())
  return { url, calls, png: PNG_BYTES }
}
