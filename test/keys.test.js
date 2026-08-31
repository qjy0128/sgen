import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { fakeSensenova } from './helpers/fake-sensenova.js'

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

function writeConfig(home, providers) {
  fs.mkdirSync(path.join(home, '.sgen'), { recursive: true })
  fs.writeFileSync(path.join(home, '.sgen', 'config.json'), JSON.stringify({ providers }))
}

test('第一把 Key 撞 429：自动换第二把重试成功', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t, { keys: ['sk-a', 'sk-b'], reject: { 'sk-a': 429 } })
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    assert.equal(fs.readdirSync(cwd.dir).length, 1)

    // 请求序列：sk-a 被 429 拒 → sk-b 成功
    assert.equal(fake.calls.length, 2)
    assert.equal(fake.calls[0].auth, 'Bearer sk-a')
    assert.equal(fake.calls[1].auth, 'Bearer sk-b')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('多把 Key 按序轮转：两次调用分别从不同 Key 起步（分摊额度）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t, { keys: ['sk-a', 'sk-b'] })
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: `${fake.url}/v1` } })

    const r1 = await run(['image', '第一张'], { env: { HOME: home.dir }, cwd: cwd.dir })
    const r2 = await run(['image', '第二张'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r1.code, 0)
    assert.equal(r2.code, 0)

    assert.equal(fake.calls.length, 2)
    assert.equal(fake.calls[0].auth, 'Bearer sk-a')
    assert.equal(fake.calls[1].auth, 'Bearer sk-b')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('更新 Key 游标时保留更新检查和视频任务状态', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })
    const stateFile = path.join(home.dir, '.sgen', 'state.json')
    fs.writeFileSync(
      stateFile,
      JSON.stringify({ remoteVersion: '9.9.9', tasks: [{ video_id: 'vid-old', model: 'agnes-video-v2.0' }] }),
    )

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.equal(state.remoteVersion, '9.9.9')
    assert.equal(state.tasks[0].video_id, 'vid-old')
    assert.equal(state.sensenova.cursor, 0)
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('两条命令并发更新状态时文件仍完整且保留其他字段', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t, { keys: ['sk-a', 'sk-b'] })
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: `${fake.url}/v1` } })
    const stateFile = path.join(home.dir, '.sgen', 'state.json')
    fs.writeFileSync(stateFile, JSON.stringify({ remoteVersion: '9.9.9' }))

    const [a, b] = await Promise.all([
      run(['image', '第一张'], { env: { HOME: home.dir }, cwd: cwd.dir }),
      run(['image', '第二张'], { env: { HOME: home.dir }, cwd: cwd.dir }),
    ])
    assert.equal(a.code, 0)
    assert.equal(b.code, 0)
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    assert.equal(state.remoteVersion, '9.9.9')
    assert.ok(Number.isInteger(state.sensenova.cursor))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('坏 Key 被跳过后不再优先尝试：下次调用直接从好 Key 起步', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t, { keys: ['sk-a', 'sk-b'], reject: { 'sk-a': 429 } })
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: `${fake.url}/v1` } })

    const r1 = await run(['image', '第一张'], { env: { HOME: home.dir }, cwd: cwd.dir })
    const r2 = await run(['image', '第二张'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r1.code, 0)
    assert.equal(r2.code, 0)

    // 第一次：sk-a 撞 429 → sk-b 成功；第二次：直接从 sk-b 起步（不再浪费一次请求打坏 Key）
    assert.deepEqual(
      fake.calls.map((c) => c.auth),
      ['Bearer sk-a', 'Bearer sk-b', 'Bearer sk-b'],
    )
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('全部 Key 都失败：退出码 1，逐把汇总原因（Key 打码）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t, { keys: [], reject: { 'sk-a': 429, 'sk-b': 429 } })
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /全部 2 把/)
    assert.match(r.stderr, /HTTP 429/)
    assert.match(r.stderr, /sgen config init/)
    // Key 打码显示，不泄露全文
    assert.ok(!r.stderr.includes('Bearer sk-a'))
    assert.match(r.stderr, /\*\*\*/)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('网络错误不触发换 Key（直接报无法连接）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    // 指向一个不存在的本地端口
    writeConfig(home.dir, {
      sensenova: { api_keys: ['sk-a', 'sk-b'], base_url: 'http://127.0.0.1:9/v1' },
    })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /无法连接/)
    assert.ok(!r.stderr.includes('全部 2 把'), '网络错误不应进入换 Key 流程')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
