import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { fakeSensenova } from './helpers/fake-sensenova.js'

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

function writeConfig(home, providers) {
  fs.mkdirSync(path.join(home, '.sgen'), { recursive: true })
  fs.writeFileSync(path.join(home, '.sgen', 'config.json'), JSON.stringify({ providers }))
}

test('缺 <提示词> 时退出码 2，并打印用法', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['image'], { env: { HOME: home.dir } })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /用法/)
  } finally {
    home.cleanup()
  }
})

test('缺少商汤 API Key 时退出码 2，并提示 sgen config init', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['image', '一只猫'], { env: { HOME: home.dir } })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /sgen config init/)
    assert.match(r.stderr, /SENSENOVA_API_KEY/)
  } finally {
    home.cleanup()
  }
})

test('文生图成功：调商汤接口（无水印）并下载到当前目录，自动命名', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只戴宇航头盔的橘猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)

    const files = fs.readdirSync(cwd.dir)
    assert.equal(files.length, 1)
    assert.match(files[0], /^sgen-\d{8}-\d{9}-[a-f0-9]{8}\.png$/)
    assert.deepEqual(fs.readFileSync(path.join(cwd.dir, files[0])), PNG_BYTES)
    assert.ok(r.stdout.includes(files[0]), `stdout 应包含文件名：${r.stdout}`)

    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].auth, 'Bearer sk-test')
    assert.equal(fake.calls[0].body.model, 'sensenova-u1.5-lite')
    assert.equal(fake.calls[0].body.prompt, '一只戴宇航头盔的橘猫')
    assert.equal(fake.calls[0].body.watermark, false)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('同一秒内连续生成两次，文件名不冲突', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    await run(['image', '第一张'], { env: { HOME: home.dir }, cwd: cwd.dir })
    await run(['image', '第二张'], { env: { HOME: home.dir }, cwd: cwd.dir })

    const files = fs.readdirSync(cwd.dir)
    assert.equal(files.length, 2)
    assert.notEqual(files[0], files[1])
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('环境变量 Key 也能出图（无配置文件时兜底）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫'], {
      env: { HOME: home.dir, SENSENOVA_API_KEY: 'sk-test' },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.equal(fs.readdirSync(cwd.dir).length, 1)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--json 输出结构化结果（ok/model/file/elapsed_ms），stdout 仅含 JSON', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--json'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    const json = JSON.parse(r.stdout)
    assert.equal(json.ok, true)
    assert.equal(json.model, 'sensenova-u1.5-lite')
    assert.ok(path.isAbsolute(json.file))
    assert.ok(fs.existsSync(json.file))
    assert.ok(Number.isFinite(json.elapsed_ms))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--out 指定确切文件路径时按该路径保存', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--out', 'result.png'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    assert.ok(fs.existsSync(path.join(cwd.dir, 'result.png')))
    assert.deepEqual(fs.readFileSync(path.join(cwd.dir, 'result.png')), PNG_BYTES)
    assert.ok(r.stdout.includes('result.png'))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--out 已存在时默认拒绝且不发生成请求；--force 才覆盖', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })
    const out = path.join(cwd.dir, 'result.png')
    fs.writeFileSync(out, '原文件')

    const rejected = await run(['image', '一只猫', '--out', out], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(rejected.code, 2)
    assert.match(rejected.stderr, /--force/)
    assert.equal(fake.calls.length, 0, '输出路径不安全时不得先消耗生成额度')
    assert.equal(fs.readFileSync(out, 'utf8'), '原文件')

    const forced = await run(['image', '一只猫', '--out', out, '--force'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(forced.code, 0)
    assert.equal(fake.calls.length, 1)
    assert.deepEqual(fs.readFileSync(out), PNG_BYTES)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--json 失败时 stdout 也是结构化 JSON', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['image', '--json'], { env: { HOME: home.dir } })
    assert.equal(r.code, 2)
    const json = JSON.parse(r.stdout)
    assert.equal(json.ok, false)
    assert.equal(json.error.kind, 'usage')
    assert.match(json.error.message, /缺少/)
  } finally {
    home.cleanup()
  }
})

test('--out 指向目录（尾斜杠）时在目录内自动命名', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  const sub = path.join(cwd.dir, 'pics')
  fs.mkdirSync(sub)
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--out', `${sub}${path.sep}`], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    const files = fs.readdirSync(sub)
    assert.equal(files.length, 1)
    assert.match(files[0], /^sgen-\d{8}-\d{9}-[a-f0-9]{8}\.png$/)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('Key 无效（HTTP 401）时退出码 1，错误信息含商汤与自救提示', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-wrong'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /商汤/)
    assert.match(r.stderr, /HTTP 401/)
    assert.match(r.stderr, /sgen config init/)
    assert.equal(fs.readdirSync(cwd.dir).length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('接口慢响应（1.2 秒）仍能成功返回', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const calls = []
    const { server, url } = await startServerHelper()
    t.after(() => server.close())
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${url}/v1` } })

    const r = await run(['image', '一只猫', '--json'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    const json = JSON.parse(r.stdout)
    assert.ok(json.elapsed_ms >= 1000, `elapsed_ms 应≥1000，实际 ${json.elapsed_ms}`)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

// 慢响应专用：延迟 1.2 秒再返回
import { startServer, readBody } from './helpers/server.js'
async function startServerHelper() {
  const calls = []
  const { server, url } = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      await readBody(req)
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ url: `${url}/img.png` }] }))
      }, 1200)
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
  return { server, url }
}
