import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { fakeAgnes } from './helpers/fake-agnes.js'
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

test('Agnes 文生图成功：鉴权、size/ratio 参数映射、结果自动下载', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const agnes = await fakeAgnes(t)
    writeConfig(home.dir, {
      sensenova: { api_keys: ['sk-test'], base_url: 'http://127.0.0.1:1/v1' },
      agnes: { api_keys: ['ak-test'], base_url: `${agnes.url}/v1` },
    })

    const r = await run(
      ['image', '一只猫', '--model', 'agnes-image-2.1-flash', '--size', '2K', '--ratio', '16:9'],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)

    const files = fs.readdirSync(cwd.dir)
    assert.equal(files.length, 1)
    assert.match(files[0], /\.png$/)
    assert.deepEqual(fs.readFileSync(path.join(cwd.dir, files[0])), PNG_BYTES)

    assert.equal(agnes.calls.length, 1)
    assert.equal(agnes.calls[0].auth, 'Bearer ak-test')
    assert.equal(agnes.calls[0].body.model, 'agnes-image-2.1-flash')
    assert.equal(agnes.calls[0].body.prompt, '一只猫')
    assert.equal(agnes.calls[0].body.size, '2K')
    assert.equal(agnes.calls[0].body.ratio, '16:9')
    // 依文档：response_format 必须嵌在 extra_body 里
    assert.equal(agnes.calls[0].body.extra_body?.response_format, 'url')
    // Agnes 没有水印参数
    assert.equal(agnes.calls[0].body.watermark, undefined)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('缺 Agnes Key：退出码 2，提示 AGNES_API_KEY 与 sgen config init', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['image', '一只猫', '--model', 'agnes-image-2.1-flash'], { env: { HOME: home.dir } })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /AGNES_API_KEY/)
    assert.match(r.stderr, /sgen config init/)
  } finally {
    home.cleanup()
  }
})

test('Agnes Key 无效（HTTP 401）：退出码 1，错误信息含 Agnes 与自救提示', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const agnes = await fakeAgnes(t)
    writeConfig(home.dir, { agnes: { api_keys: ['ak-wrong'], base_url: `${agnes.url}/v1` } })

    const r = await run(['image', '一只猫', '--model', 'agnes-image-2.1-flash'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /Agnes/)
    assert.match(r.stderr, /HTTP 401/)
    assert.match(r.stderr, /sgen config init/)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('agnes-image-2.0-flash：精确像素透传、不发送 ratio 字段', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const agnes = await fakeAgnes(t)
    writeConfig(home.dir, { agnes: { api_keys: ['ak-test'], base_url: `${agnes.url}/v1` } })

    const r = await run(
      ['image', '一只猫', '--model', 'agnes-image-2.0-flash', '--size', '1024x768'],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    assert.equal(agnes.calls[0].body.size, '1024x768')
    assert.equal(agnes.calls[0].body.ratio, undefined)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('默认模型仍是商汤 u1.5-lite（不传 --model 时行为不变）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeSensenova(t)
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-test'], base_url: `${fake.url}/v1` } })

    const r = await run(['image', '一只猫'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    assert.equal(fake.calls[0].body.model, 'sensenova-u1.5-lite')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('Agnes 图生图（多图）：--image 两张 → extra_body.image 数组为 Data URI', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9])
    const ref1 = path.join(cwd.dir, 'a.png')
    const ref2 = path.join(cwd.dir, 'b.jpg')
    fs.writeFileSync(ref1, png)
    fs.writeFileSync(ref2, png)

    const agnes = await fakeAgnes(t)
    writeConfig(home.dir, { agnes: { api_keys: ['ak-test'], base_url: `${agnes.url}/v1` } })

    const r = await run(
      ['image', '把两张图合成', '--model', 'agnes-image-2.1-flash', '--image', ref1, '--image', ref2],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    assert.equal(agnes.calls[0].body.extra_body.image.length, 2)
    assert.equal(agnes.calls[0].body.extra_body.image[0], `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(agnes.calls[0].body.extra_body.image[1], `data:image/jpeg;base64,${png.toString('base64')}`)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
