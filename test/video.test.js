import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from './helpers/run.js'
import { fakeAgnesVideo } from './helpers/fake-agnes-video.js'

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

function writeConfig(home, providers) {
  fs.mkdirSync(path.join(home, '.sgen'), { recursive: true })
  fs.writeFileSync(path.join(home, '.sgen', 'config.json'), JSON.stringify({ providers }))
}

function agnesConfig(home, base) {
  writeConfig(home.dir, { agnes: { api_keys: ['ak-test'], base_url: base } })
}

test('文生视频全流程：提交→轮询（带 model_name）→出片自动下载', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '日落海滩航拍', '--json'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    const json = JSON.parse(r.stdout)
    assert.equal(json.ok, true)
    assert.equal(json.model, 'agnes-video-2.5-flash')
    assert.ok(json.video_id)

    // 创建请求：text 模式、默认 5 秒、720P、Bearer 鉴权
    assert.equal(fake.creations.length, 1)
    assert.equal(fake.creations[0].auth, 'Bearer ak-test')
    assert.equal(fake.creations[0].body.model, 'agnes-video-2.5-flash')
    assert.equal(fake.creations[0].body.prompt, '日落海滩航拍')
    assert.equal(fake.creations[0].body.mode, 'text')
    assert.equal(fake.creations[0].body.seconds, '5')
    assert.equal(fake.creations[0].body.size, '720P')

    // 轮询：带 video_id 与 model_name
    assert.ok(fake.polls.length >= 2)
    assert.ok(fake.polls.every((p) => p.videoId === json.video_id))
    assert.ok(fake.polls.every((p) => p.modelName === 'agnes-video-2.5-flash'))

    // 出片下载为 mp4
    const files = fs.readdirSync(cwd.dir)
    assert.equal(files.length, 1)
    assert.match(files[0], /^sgen-\d{8}-\d{6}-\d+\.mp4$/)
    assert.deepEqual(fs.readFileSync(path.join(cwd.dir, files[0])), fake.mp4)
    assert.equal(path.basename(json.file), files[0])
    assert.ok(fs.existsSync(json.file))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--seconds 与 --ratio 正确映射（8 秒、9:16）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '一只猫在跑', '--seconds', '8', '--ratio', '9:16'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    assert.equal(fake.creations[0].body.seconds, '8')
    assert.equal(fake.creations[0].body.aspect_ratio, '9:16')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('--no-wait 立即返回 video_id 不落盘；status 可查询、续等并下载', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    const r1 = await run(['video', '城市夜景', '--no-wait', '--json'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r1.code, 0)
    const j1 = JSON.parse(r1.stdout)
    assert.ok(j1.video_id)
    assert.equal(fs.readdirSync(cwd.dir).length, 0, 'no-wait 不应下载文件')

    // 单次查询：任务仍在进行，报告状态不下载
    const r2 = await run(['status', j1.video_id, '--json'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r2.code, 0)
    const j2 = JSON.parse(r2.stdout)
    assert.equal(j2.status, 'in_progress')

    // 续等：轮询到完成并自动下载
    const r3 = await run(['status', j1.video_id, '--wait', '--json'], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r3.code, 0)
    const j3 = JSON.parse(r3.stdout)
    assert.equal(j3.status, 'completed')
    const files = fs.readdirSync(cwd.dir)
    assert.equal(files.length, 1)
    assert.match(files[0], /\.mp4$/)
    assert.deepEqual(fs.readFileSync(path.join(cwd.dir, files[0])), fake.mp4)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('状态查询被 429 限流：自动退避重试最终成功（不误判为任务失败）', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 2, rateLimitPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '日落海滩', '--timeout', '30'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    assert.match(r.stderr, /退避重试/)
    assert.equal(fs.readdirSync(cwd.dir).filter((f) => f.endsWith('.mp4')).length, 1)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('等待超时：退出码 1，报错含 video_id 与 sgen status 恢复提示', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: Infinity })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '慢任务', '--timeout', '3'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /超时/)
    assert.match(r.stderr, /vid-1/)
    assert.match(r.stderr, /sgen status vid-1/)
    assert.equal(fs.readdirSync(cwd.dir).length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('任务失败：退出码 1，透出 API 错误原文', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t, { failWith: '内容不合规' })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '违规内容'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /内容不合规/)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('sgen video 选商汤模型：本地拦截并说明商汤无视频 API', async (t) => {
  const home = tmpDir('sgen-home-')
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '一只猫', '--model', 'sensenova-u1.5-lite'], {
      env: { HOME: home.dir },
    })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /商汤/)
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
  }
})

test('时长/尺寸/比例非法：本地拦截（零请求）', async (t) => {
  const home = tmpDir('sgen-home-')
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    for (const [args, pattern] of [
      [['--seconds', '13'], /4–12/],
      [['--seconds', '3'], /4–12/],
      [['--size', '1080P'], /720P/],
      [['--ratio', '16:10'], /21:9/],
    ]) {
      const r = await run(['video', '一只猫', ...args], { env: { HOME: home.dir } })
      assert.equal(r.code, 2, `参数 ${args} 应被拦截`)
      assert.match(r.stderr, pattern)
    }
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
  }
})

test('--timeout 为 0、负数或非数字：本地拦截（不再静默回落到默认 600）', async (t) => {
  const home = tmpDir('sgen-home-')
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    for (const args of [
      ['video', '一只猫', '--timeout', '0'],
      ['video', '一只猫', '--timeout', '-5'],
      ['video', '一只猫', '--timeout', 'abc'],
      ['status', 'vid_1', '--timeout', '0'],
    ]) {
      const r = await run(args, { env: { HOME: home.dir } })
      assert.equal(r.code, 2, `参数 ${args} 应被拦截，输出：${r.stdout}${r.stderr}`)
      assert.match(r.stderr, /--timeout/)
    }
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
  }
})

test('Agnes 中国版区域配置：video 生成时不再每次刷域名提示', async (t) => {
  const home = tmpDir('sgen-home-')
  const cwd = tmpDir('sgen-cwd-')
  try {
    const fake = await fakeAgnesVideo(t)
    writeConfig(home.dir, { agnes: { api_keys: ['ak-test'], base_url: `${fake.url}/v1`, region: 'china' } })

    const r = await run(['video', '日落海滩', '--no-wait'], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 0)
    assert.ok(!r.stderr.includes('api.agnes-ai.cn'), `stderr 不应再刷域名提示：${r.stderr}`)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('text 模式禁带媒体参数的行为已由工单 06 升级：媒体参数现用于推导 keyframe/reference 模式（见 video-advanced.test.js）', { skip: true }, () => {})
