import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { startServer } from './helpers/server.js'

const LOCAL_VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sgen-home-'))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

function stateFile(home) {
  return path.join(home, '.sgen', 'state.json')
}

async function waitFor(fn, ms = 5000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (await fn()) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

// 假 raw.githubusercontent.com：返回指定版本号的 package.json；hits() 给出累计请求数
async function fakeRegistry(t, version) {
  let hits = 0
  const { server, url } = await startServer((req, res) => {
    hits++
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ name: 'sgen', version }))
  })
  t.after(() => server.close())
  return { url, hits: () => hits }
}

test('远端版本更高：当次命令零延迟，状态落盘后下次命令 stderr 提示更新', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    const env = { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url }

    const r1 = await run(['models'], { env, updateCheck: true })
    assert.equal(r1.code, 0)
    assert.equal(r1.stderr, '', '当次命令不等待检查结果')

    const ok = await waitFor(() => fs.existsSync(stateFile(home.dir)))
    assert.ok(ok, '后台检查应写入 state.json')

    const r2 = await run(['models'], { env, updateCheck: true })
    assert.equal(r2.code, 0)
    assert.match(r2.stderr, /新版本 v99\.0\.0/)
    assert.match(r2.stderr, new RegExp(`当前 v${LOCAL_VERSION.replaceAll('.', '\\.')}`))
  } finally {
    home.cleanup()
  }
})

test('远端版本与本地相等或更低：无提示', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, LOCAL_VERSION)
    const env = { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url }

    await run(['models'], { env, updateCheck: true })
    await waitFor(() => fs.existsSync(stateFile(home.dir)))

    const r = await run(['models'], { env, updateCheck: true })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '', '版本不落后时不提示')
  } finally {
    home.cleanup()
  }
})

test('提示不污染 stdout：--json 输出仍是纯 JSON', async (t) => {
  const { fakeSensenova } = await import('./helpers/fake-sensenova.js')
  const home = tmpHome()
  const cwd = tmpHome()
  try {
    const sn = await fakeSensenova(t)
    const reg = await fakeRegistry(t, '99.0.0')
    fs.mkdirSync(path.join(home.dir, '.sgen'), { recursive: true })
    fs.writeFileSync(
      path.join(home.dir, '.sgen', 'config.json'),
      JSON.stringify({ providers: { sensenova: { api_keys: ['sk-test'], base_url: `${sn.url}/v1` } } }),
    )
    // 预置状态：远端已有新版本（等效于上一次命令已完成检查）
    fs.writeFileSync(stateFile(home.dir), JSON.stringify({ remoteVersion: '99.0.0' }))

    const r = await run(['image', '一只猫', '--json'], {
      env: { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url },
      cwd: cwd.dir,
      updateCheck: true,
    })
    assert.equal(r.code, 0, `生图应成功：${r.stderr}`)
    const json = JSON.parse(r.stdout) // stdout 必须可整体解析为 JSON
    assert.equal(json.ok, true)
    assert.match(r.stderr, /新版本 v99\.0\.0/)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('检查接口 500：命令正常成功、无提示、状态只记 checkedAt（无 remoteVersion）', async (t) => {
  const home = tmpHome()
  try {
    const { server, url } = await startServer((req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'boom' }))
    })
    t.after(() => server.close())

    const r = await run(['models'], { env: { HOME: home.dir, SGEN_UPDATE_CHECK_URL: url }, updateCheck: true })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
    await waitFor(() => fs.existsSync(stateFile(home.dir)))
    const state = JSON.parse(fs.readFileSync(stateFile(home.dir), 'utf8'))
    assert.ok(state.checkedAt > 0, '失败也应记 checkedAt（当天不再重试）')
    assert.equal(state.remoteVersion, undefined, '失败不应写入 remoteVersion')
  } finally {
    home.cleanup()
  }
})

test('检查接口挂起：主进程零等待正常退出', async (t) => {
  const home = tmpHome()
  try {
    const { server, url } = await startServer(() => {}) // 永不响应
    t.after(() => server.close())

    const startedAt = Date.now()
    const r = await run(['models'], { env: { HOME: home.dir, SGEN_UPDATE_CHECK_URL: url }, updateCheck: true })
    assert.equal(r.code, 0)
    assert.ok(Date.now() - startedAt < 3000, '后台检查不得拖住主进程退出')
  } finally {
    home.cleanup()
  }
})

test('SGEN_NO_UPDATE_CHECK=1（测试默认值）：不发请求、不写状态、无提示', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    // 不传 updateCheck：helper 注入 SGEN_NO_UPDATE_CHECK=1
    const r = await run(['models'], { env: { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url } })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
    await new Promise((r2) => setTimeout(r2, 300))
    assert.equal(reg.hits(), 0, '禁用时不应向检查地址发请求')
    assert.equal(fs.existsSync(stateFile(home.dir)), false)
  } finally {
    home.cleanup()
  }
})

test('24 小时内不重复发检查请求', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    const env = { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url }

    await run(['models'], { env, updateCheck: true })
    await waitFor(() => fs.existsSync(stateFile(home.dir)))
    assert.equal(reg.hits(), 1)

    await run(['models'], { env, updateCheck: true })
    await new Promise((r2) => setTimeout(r2, 300))
    assert.equal(reg.hits(), 1, '24 小时内第二次运行不应再请求')
  } finally {
    home.cleanup()
  }
})

test('同一版本当天已提示过：再次运行不重复提示', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    // 预置：今天已检查过、已就 99.0.0 提示过
    fs.mkdirSync(path.join(home.dir, '.sgen'), { recursive: true })
    fs.writeFileSync(
      stateFile(home.dir),
      JSON.stringify({
        checkedAt: Date.now(),
        remoteVersion: '99.0.0',
        notified: { version: '99.0.0', at: Date.now() },
      }),
    )

    const r = await run(['models'], { env: { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url }, updateCheck: true })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '', '同版本当天已提示过不应重复提示')
  } finally {
    home.cleanup()
  }
})

test('远端升到更高版本：即使当天已提示过旧版本也再次提示', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    const env = { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url }
    // 预置：昨天检查到 98.0.0 且今天已提示过；checkedAt 已过 24h，本次会重新检查
    fs.mkdirSync(path.join(home.dir, '.sgen'), { recursive: true })
    fs.writeFileSync(
      stateFile(home.dir),
      JSON.stringify({
        checkedAt: Date.now() - 25 * 60 * 60 * 1000,
        remoteVersion: '98.0.0',
        notified: { version: '98.0.0', at: Date.now() },
      }),
    )

    await run(['models'], { env, updateCheck: true })
    await waitFor(() => {
      try {
        return JSON.parse(fs.readFileSync(stateFile(home.dir), 'utf8')).remoteVersion === '99.0.0'
      } catch {
        return false
      }
    })

    const r = await run(['models'], { env, updateCheck: true })
    assert.equal(r.code, 0)
    assert.match(r.stderr, /新版本 v99\.0\.0/, '更高版本应突破同版本去重')
  } finally {
    home.cleanup()
  }
})

test('CI=true：不发请求、无提示', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    const r = await run(['models'], {
      env: { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url, CI: 'true' },
      updateCheck: true,
    })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
    await new Promise((r2) => setTimeout(r2, 300))
    assert.equal(reg.hits(), 0, 'CI 环境不应发检查请求')
    assert.equal(fs.existsSync(stateFile(home.dir)), false)
  } finally {
    home.cleanup()
  }
})

test('config update_check=false：set 可设、list 可见、检查被禁用', async (t) => {
  const home = tmpHome()
  try {
    const reg = await fakeRegistry(t, '99.0.0')
    const env = { HOME: home.dir, SGEN_UPDATE_CHECK_URL: reg.url }

    // set 本身用默认禁用跑（此刻配置尚未写入，开启检查会产生一次合法请求，干扰计数）
    const set = await run(['config', 'set', 'update_check', 'false'], { env })
    assert.equal(set.code, 0, `set 应成功：${set.stderr}`)

    const list = await run(['config', 'list'], { env, updateCheck: true })
    assert.equal(list.code, 0)
    assert.match(list.stdout, /update_check.*false|更新检查.*(关|禁用)/, 'list 应展示更新检查已关闭')

    const r = await run(['models'], { env, updateCheck: true })
    assert.equal(r.code, 0)
    assert.equal(r.stderr, '')
    await new Promise((r2) => setTimeout(r2, 300))
    assert.equal(reg.hits(), 0, 'update_check=false 时不应发检查请求')
  } finally {
    home.cleanup()
  }
})
