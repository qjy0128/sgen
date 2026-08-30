import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { fakeSensenova } from './helpers/fake-sensenova.js'
import { fakeAgnes } from './helpers/fake-agnes.js'

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

function readConfig(home) {
  return JSON.parse(fs.readFileSync(path.join(home, '.sgen', 'config.json'), 'utf8'))
}

function writeConfig(home, providers) {
  fs.mkdirSync(path.join(home, '.sgen'), { recursive: true })
  fs.writeFileSync(path.join(home, '.sgen', 'config.json'), JSON.stringify({ providers }))
}

test('config init：管道输入写入多 Key 与区域；china 给出 Key 不通用提醒', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['config', 'init'], {
      env: { HOME: home.dir },
      stdin: 'sk-aaa,sk-bbb\nak-xxx\nchina\n',
    })
    assert.equal(r.code, 0)
    const cfg = readConfig(home.dir)
    assert.deepEqual(cfg.providers.sensenova.api_keys, ['sk-aaa', 'sk-bbb'])
    assert.deepEqual(cfg.providers.agnes.api_keys, ['ak-xxx'])
    assert.equal(cfg.providers.agnes.region, 'china')
    assert.match(r.stderr, /不通用/)
    assert.ok(r.stdout.includes('已写入'))
  } finally {
    home.cleanup()
  }
})

test('config init：保留已有 base_url 覆写', async () => {
  const home = tmpDir('sgen-home-')
  try {
    writeConfig(home.dir, { sensenova: { api_keys: ['sk-old'], base_url: 'http://example/v1' } })
    const r = await run(['config', 'init'], {
      env: { HOME: home.dir },
      stdin: 'sk-new\n\n\n',
    })
    assert.equal(r.code, 0)
    const cfg = readConfig(home.dir)
    assert.deepEqual(cfg.providers.sensenova.api_keys, ['sk-new'])
    assert.equal(cfg.providers.sensenova.base_url, 'http://example/v1')
    assert.equal(cfg.providers.agnes.region, 'international')
  } finally {
    home.cleanup()
  }
})

test('config list：Key 打码显示，不泄露完整 Key', async () => {
  const home = tmpDir('sgen-home-')
  try {
    writeConfig(home.dir, {
      sensenova: { api_keys: ['sk-aaaaaaabbbbbbbb'] },
      agnes: { api_keys: ['ak-ccccccccdddddddd'] },
    })
    const r = await run(['config', 'list'], { env: { HOME: home.dir } })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /\*\*\*/)
    assert.ok(!r.stdout.includes('sk-aaaaaaabbbbbbbb'), '完整商汤 Key 不应出现')
    assert.ok(!r.stdout.includes('ak-ccccccccdddddddd'), '完整 Agnes Key 不应出现')
    assert.match(r.stdout, /international/)
    assert.match(r.stdout, /商汤/)
    assert.match(r.stdout, /Agnes/)
  } finally {
    home.cleanup()
  }
})

test('config set：region 切换（含提醒）、api_keys 逗号转数组、非法路径拒绝', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r1 = await run(['config', 'set', 'agnes.region', 'china'], { env: { HOME: home.dir } })
    assert.equal(r1.code, 0)
    assert.equal(readConfig(home.dir).providers.agnes.region, 'china')
    assert.match(r1.stderr, /不通用/)

    const r2 = await run(['config', 'set', 'sensenova.api_keys', 'sk-1, sk-2'], { env: { HOME: home.dir } })
    assert.equal(r2.code, 0)
    assert.deepEqual(readConfig(home.dir).providers.sensenova.api_keys, ['sk-1', 'sk-2'])

    const r3 = await run(['config', 'set', 'foo.bar', 'x'], { env: { HOME: home.dir } })
    assert.equal(r3.code, 2)
  } finally {
    home.cleanup()
  }
})

test('config test：逐把 Key 连通性报告（好 Key 连通、坏 Key 鉴权失败、未配置跳过）', async (t) => {
  const home = tmpDir('sgen-home-')
  try {
    const fake = await fakeSensenova(t, { keys: ['sk-good'] })
    writeConfig(home.dir, {
      sensenova: { api_keys: ['sk-good', 'sk-bad'], base_url: `${fake.url}/v1` },
    })

    const r = await run(['config', 'test'], { env: { HOME: home.dir } })
    assert.equal(r.code, 0)
    assert.match(r.stdout, /连通（HTTP 200）/)
    assert.match(r.stdout, /鉴权失败（HTTP 401）/)
    assert.match(r.stdout, /未配置/)
    assert.ok(!r.stdout.includes('sk-good'), '完整 Key 不应出现')
    assert.ok(r.stdout.includes('***'))
  } finally {
    home.cleanup()
  }
})

test('region=china 时使用 Agnes：stderr 提醒 Key 不通用，生图正常', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const agnes = await fakeAgnes(t)
    writeConfig(home.dir, {
      agnes: { api_keys: ['ak-test'], region: 'china', base_url: `${agnes.url}/v1` },
    })

    const r = await run(['image', '一只猫', '--model', 'agnes-image-2.1-flash'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.match(r.stderr, /不通用/)
    assert.equal(fs.readdirSync(cwd.dir).length, 1)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
