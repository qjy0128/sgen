import { startServer, readBody } from './server.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

// 模拟 Agnes 的假服务器：记录请求，按 Key 鉴权，成功返回图片 URL
export async function fakeAgnes(t, { key = 'ak-test' } = {}) {
  const calls = []
  const { server, url } = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      const body = await readBody(req)
      calls.push({ auth: req.headers.authorization, body })
      if (req.headers.authorization !== `Bearer ${key}`) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '未提供令牌' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ created: 1, data: [{ url: `${url}/img.png`, revised_prompt: body.prompt }] }))
      return
    }
    if (req.url === '/img.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  })
  t.after(() => server.close())
  return { url, calls, png: PNG_BYTES }
}
