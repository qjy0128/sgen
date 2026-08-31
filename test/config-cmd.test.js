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

test('sgen config 不带子命令：列出全部可设项、含义与可复制示例', async () => {
  const r = await run(['config'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /agnes\.region/)
  assert.match(r.stderr, /international=国际版/)
  assert.match(r.stderr, /china=中国版/)
  assert.match(r.stderr, /sgen config set agnes\.region china/)
  assert.match(r.stderr, /sgen config set sensenova\.api_keys sk-aaa,sk-bbb/)
  assert.match(r.stderr, /功能完全一致/)
})

test('sgen config set 缺参数：报错中同样给出可设项与示例', async () => {
  const r = await run(['config', 'set'])
  assert.equal(r.code, 2)
  assert.match(r.stderr, /agnes\.region/)
  assert.match(r.stderr, /sgen config set agnes\.region china/)
})

test('sgen --help：包含 config set 示例与"可选值见 sgen models"指引', async () => {
  const r = await run(['--help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /sgen config set agnes\.region china/)
  assert.match(r.stdout, /sgen models/)
})

test('config init：答 Y（在中国境内）→ china，并给出区域说明（Key 目前通用）', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['config', 'init'], {
      env: { HOME: home.dir },
      stdin: 'sk-aaa,sk-bbb\nak-xxx\nY\n',
    })
    assert.equal(r.code, 0)
    const cfg = readConfig(home.dir)
    assert.deepEqual(cfg.providers.sensenova.api_keys, ['sk-aaa', 'sk-bbb'])
    assert.deepEqual(cfg.providers.agnes.api_keys, ['ak-xxx'])
    assert.equal(cfg.providers.agnes.region, 'china')
    assert.match(r.stderr, /目前通用/)
    assert.ok(r.stdout.includes('已写入'))
    assert.match(r.stdout, /是否在中国境内/)
  } finally {
    home.cleanup()
  }
})

test('config init：答 n 或空 → international（默认）', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const a = await run(['config', 'init'], { env: { HOME: home.dir }, stdin: 'sk-1\nak-1\nn\n' })
    assert.equal(a.code, 0)
    assert.equal(readConfig(home.dir).providers.agnes.region, 'international')

    const b = await run(['config', 'init'], { env: { HOME: home.dir }, stdin: 'sk-1\nak-1\n随便打的\n' })
    assert.equal(b.code, 0)
    assert.equal(readConfig(home.dir).providers.agnes.region, 'international')
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

test('config init：Key 留空时保留已有 Key，不会误清空', async () => {
  const home = tmpDir('sgen-home-')
  try {
    writeConfig(home.dir, {
      sensenova: { api_keys: ['sk-old'] },
      agnes: { api_keys: ['ak-old'], region: 'international' },
    })
    const r = await run(['config', 'init'], { env: { HOME: home.dir }, stdin: '\n\n\n' })
    assert.equal(r.code, 0)
    const cfg = readConfig(home.dir)
    assert.deepEqual(cfg.providers.sensenova.api_keys, ['sk-old'])
    assert.deepEqual(cfg.providers.agnes.api_keys, ['ak-old'])
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
    assert.match(r1.stderr, /目前通用/)

    const r2 = await run(['config', 'set', 'sensenova.api_keys', 'sk-1, sk-2'], { env: { HOME: home.dir } })
    assert.equal(r2.code, 0)
    assert.deepEqual(readConfig(home.dir).providers.sensenova.api_keys, ['sk-1', 'sk-2'])

    const r3 = await run(['config', 'set', 'foo.bar', 'x'], { env: { HOME: home.dir } })
    assert.equal(r3.code, 2)

    const r4 = await run(['config', 'set', 'agnes.base_url', 'file:///tmp/api'], { env: { HOME: home.dir } })
    assert.equal(r4.code, 2)
    assert.match(r4.stderr, /http/)
  } finally {
    home.cleanup()
  }
})

test('config test：任一 Key 失败时返回 1，且支持结构化结果', async (t) => {
  const home = tmpDir('sgen-home-')
  try {
    const fake = await fakeSensenova(t, { keys: ['sk-good'] })
    writeConfig(home.dir, {
      sensenova: { api_keys: ['sk-good', 'sk-bad'], base_url: `${fake.url}/v1` },
    })

    const r = await run(['config', 'test'], { env: { HOME: home.dir } })
    assert.equal(r.code, 1)
    assert.match(r.stdout, /连通（HTTP 200）/)
    assert.match(r.stdout, /鉴权失败（HTTP 401）/)
    assert.match(r.stdout, /未配置/)
    assert.ok(!r.stdout.includes('sk-good'), '完整 Key 不应出现')
    assert.ok(r.stdout.includes('***'))

    const jsonRun = await run(['config', 'test', '--json'], { env: { HOME: home.dir } })
    assert.equal(jsonRun.code, 1)
    const json = JSON.parse(jsonRun.stdout)
    assert.equal(json.ok, false)
    assert.ok(json.results.some((x) => x.status === 'ok'))
    assert.ok(json.results.some((x) => x.status === 'auth_failed'))
    assert.ok(!jsonRun.stdout.includes('sk-good'))
  } finally {
    home.cleanup()
  }
})

test('配置目录和配置文件只允许当前用户访问', async () => {
  const home = tmpDir('sgen-home-')
  try {
    const r = await run(['config', 'set', 'sensenova.api_keys', 'sk-secret'], { env: { HOME: home.dir } })
    assert.equal(r.code, 0)
    const dirMode = fs.statSync(path.join(home.dir, '.sgen')).mode & 0o777
    const fileMode = fs.statSync(path.join(home.dir, '.sgen', 'config.json')).mode & 0o777
    assert.equal(dirMode, 0o700)
    assert.equal(fileMode, 0o600)
  } finally {
    home.cleanup()
  }
})

test('region=china 时使用 Agnes：生图正常，且不再每次刷域名提示（只在 config 命令里提示）', async (t) => {
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
    assert.ok(!r.stderr.includes('目前通用'), `stderr 不应再刷域名提示：${r.stderr}`)
    assert.equal(fs.readdirSync(cwd.dir).length, 1)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
