import http from 'node:http'

export function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      resolve({ server, port, url: `http://127.0.0.1:${port}` })
    })
  })
}

export function readBody(req) {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => resolve(body ? JSON.parse(body) : null))
  })
}
