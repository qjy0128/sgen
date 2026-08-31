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

// 断言"本地拦截"：退出码 2、stderr 含关键提示、假服务器收到 0 个请求、不落盘
async function assertRejected(t, args, stderrPattern) {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', ...args], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 2, `应本地拦截，实际输出：${r.stdout}${r.stderr}`)
    assert.match(r.stderr, stderrPattern)
    assert.equal(fake.calls.length, 0, '非法参数不应发出任何 HTTP 请求')
    assert.equal(fs.readdirSync(cwd.dir).length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
}

test('u1-fast 传 4K：本地拦截并列出 1K/2K', async (t) => {
  await assertRejected(t, ['--model', 'sensenova-u1-fast', '--size', '4K'], /1K、2K/)
})

test('u1-fast 传精确像素：本地拦截（仅支持档位）', async (t) => {
  await assertRejected(t, ['--model', 'sensenova-u1-fast', '--size', '1024x1024'], /1K、2K/)
})

test('u1.5-lite 传非 32 倍数宽高：本地拦截并提示 32 的倍数', async (t) => {
  await assertRejected(t, ['--size', '1000x1000'], /32 的倍数/)
})

test('u1.5-lite 传超 4096 宽：本地拦截并提示范围', async (t) => {
  await assertRejected(t, ['--size', '4128x1024'], /512–4096/)
})

test('u1.5-lite 传超 3:1 比例：本地拦截并提示比例上限', async (t) => {
  await assertRejected(t, ['--size', '4096x1024'], /3:1/)
})

test('u1.5-lite 档位换算：--size 2K --ratio 16:9 → 精确像素 2048x1152 发给 API', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--size', '2K', '--ratio', '16:9'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.equal(fake.calls[0].body.size, '2048x1152')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('u1.5-lite 未知档位（3K）与非法比例：本地拦截', async (t) => {
  await assertRejected(t, ['--size', '3K'], /1K、2K、4K/)
  await assertRejected(t, ['--ratio', '16:10'], /21:9/)
})

test('agnes-image-2.1-flash 传 8 档之外的比例：本地拦截并列出可选值', async (t) => {
  await assertRejected(t, ['--model', 'agnes-image-2.1-flash', '--ratio', '5:5'], /1:1.*21:9/)
})

test('image 选视频模型：本地拦截并提示用 sgen video', async (t) => {
  await assertRejected(t, ['--model', 'agnes-video-2.5-flash'], /sgen video/)
})

test('u1-fast 档位+比例换算为精确像素（1K 16:9 → 1792x992）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(
      ['image', '一只猫', '--model', 'sensenova-u1-fast', '--size', '1K', '--ratio', '16:9'],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    assert.equal(fake.calls[0].body.model, 'sensenova-u1-fast')
    assert.equal(fake.calls[0].body.size, '1792x992')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('u1-fast 不传 size 默认 1K 1:1 → 1344x1344', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--model', 'sensenova-u1-fast'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.equal(fake.calls[0].body.size, '1344x1344')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('u1-fast 2K 9:21 → 1344x3136；非法比例被拦截并列出 10 档', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const ok = await run(
      ['image', '一只猫', '--model', 'sensenova-u1-fast', '--size', '2K', '--ratio', '9:21'],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(ok.code, 0)
    assert.equal(fake.calls[0].body.size, '1344x3136')

    const bad = await run(
      ['image', '一只猫', '--model', 'sensenova-u1-fast', '--ratio', '5:5'],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(bad.code, 2)
    assert.match(bad.stderr, /1:1.*9:21/)
    assert.equal(fake.calls.length, 1, '非法比例不应再发请求')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('未知模型名：跳过本地校验直接透传（model 与 size 原样到达 API）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--model', 'sensenova-u2-pro', '--size', '8K'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.equal(fake.calls[0].body.model, 'sensenova-u2-pro')
    assert.equal(fake.calls[0].body.size, '8K')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('未知模型名 + --ratio：本地拦截（无从校验）', async (t) => {
  await assertRejected(t, ['--model', 'sensenova-u2-pro', '--ratio', '16:9'], /--ratio/)
})

test('flag 的值以 -- 开头（如 --size --json）：视为缺值本地拦截', async (t) => {
  await assertRejected(t, ['--size', '--json'], /--size 缺少值/)
})
