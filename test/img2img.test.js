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

function writePng(dir, name = 'ref.png') {
  const p = path.join(dir, name)
  fs.writeFileSync(p, PNG_BYTES)
  return p
}

test('商汤图生图：--image 本地文件走 /v1/images/edits，参考图为 Data-URL 数组', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const ref = writePng(cwd.dir)
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '把背景换成日落', '--image', ref], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)

    assert.equal(fake.calls.length, 1)
    assert.ok(fake.calls[0].body !== undefined)
    // 请求打在 edits 接口（fake.calls[0].path 由 helper 记录）
    assert.equal(fake.calls[0].path, '/v1/images/edits')
    const expected = `data:image/png;base64,${PNG_BYTES.toString('base64')}`
    assert.deepEqual(fake.calls[0].body.images, [expected])
    assert.equal(fake.calls[0].body.prompt, '把背景换成日落')
    assert.equal(fake.calls[0].body.watermark, false)
    assert.equal(fake.calls[0].body.model, 'sensenova-u1.5-lite')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('商汤图生图多图：--image 重复传两张，两张都编码为数组', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const ref1 = writePng(cwd.dir, 'a.png')
    const ref2 = writePng(cwd.dir, 'b.png')
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '合成一张', '--image', ref1, '--image', ref2], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.equal(fake.calls[0].body.images.length, 2)
    assert.equal(fake.calls[0].body.images[0], `data:image/png;base64,${PNG_BYTES.toString('base64')}`)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--image 文件不存在：本地拦截，人话报错', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--image', './不存在.png'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /不存在\.png/)
    assert.equal(fake.calls.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('不支持图生图的模型（u1-fast）传 --image：本地拦截', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const ref = writePng(cwd.dir)
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫', '--model', 'sensenova-u1-fast', '--image', ref], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /不支持图生图/)
    assert.equal(fake.calls.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
