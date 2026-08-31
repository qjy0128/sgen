import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { startServer, readBody } from './helpers/server.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

function writeConfig(home, providers) {
  fs.mkdirSync(path.join(home, '.sgen'), { recursive: true })
  fs.writeFileSync(path.join(home, '.sgen', 'config.json'), JSON.stringify({ providers }))
}

test('生成请求连接被掐断：不自动重试，避免重复生成或扣费', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    let attempts = 0
    const { server, url } = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/images/generations') {
        attempts++
        if (attempts === 1) {
          req.socket.destroy() // 模拟网络抖动：连接被对端重置
          return
        }
        await readBody(req)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ url: `${url}/img.png` }] }))
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
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: `${url}/v1` } })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.equal(attempts, 1, '生成类 POST 不得自动重发')
    assert.match(r.stderr, /未自动重试/)
    assert.match(r.stderr, /重复生成|重复扣费/)
    assert.equal(fs.readdirSync(cwd.dir).length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('对端挂起不响应：按 SGEN_HTTP_TIMEOUT_MS 超时退出，报错含"请求超时"', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    // 收到请求后永不响应，模拟对端挂起
    const { server, url } = await startServer(() => {})
    t.after(() => server.close())
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${url}/v1` } })

    const startedAt = Date.now()
    const r = await run(['image', '一只猫'], {
      env: { HOME: home.dir, SGEN_HTTP_TIMEOUT_MS: '300' },
      cwd: cwd.dir,
    })
    assert.ok(Date.now() - startedAt < 5000, '应在超时后快速退出，而不是一直等')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /请求超时/)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('下载失败不会泄露临时 URL 的签名参数', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    let origin
    const { server, url } = await startServer(async (req, res) => {
      origin = url
      if (req.method === 'POST') {
        await readBody(req)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ url: `${origin}/broken.png?token=top-secret` }] }))
        return
      }
      if (req.url.startsWith('/broken.png')) {
        req.socket.destroy()
        return
      }
      res.writeHead(404)
      res.end()
    })
    t.after(() => server.close())
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${url}/v1` } })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /下载失败/)
    assert.ok(!r.stderr.includes('top-secret'))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
