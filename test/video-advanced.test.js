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

function mediaSetup(t, home) {
  const cwd = tmpDir('sgen-cwd-')
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
  const a = path.join(cwd.dir, 'a.png')
  const b = path.join(cwd.dir, 'b.png')
  fs.writeFileSync(a, png)
  fs.writeFileSync(b, png)
  const mp3 = path.join(cwd.dir, 's.mp3')
  fs.writeFileSync(mp3, Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]))
  const mp4 = path.join(cwd.dir, 'v.mp4')
  fs.writeFileSync(mp4, Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))
  return { cwd, png, a, b, mp3, mp4 }
}

test('keyframe 首尾帧：first_frame/last_frame 为 Data URI，mode=keyframe', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, png, a, b } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '让画面动起来', '--first-frame', a, '--last-frame', b], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    const body = fake.creations[0].body
    assert.equal(body.mode, 'keyframe')
    assert.equal(body.first_frame, `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(body.last_frame, `data:image/png;base64,${png.toString('base64')}`)
    assert.equal(body.seconds, '5')
    assert.equal(fs.readdirSync(cwd.dir).filter((f) => f.startsWith('sgen-') && f.endsWith('.mp4')).length, 1)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('仅首帧：keyframe 模式，不带 last_frame', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, a } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '图片动起来', '--first-frame', a], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 0)
    const body = fake.creations[0].body
    assert.equal(body.mode, 'keyframe')
    assert.ok(body.first_frame.startsWith('data:image/png;base64,'))
    assert.equal(body.last_frame, undefined)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('reference 模式：参考图（Data URI）与参考音频正确到达', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, png, mp3, a, b } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(
      ['video', '按 <Picture 1> 的风格生成', '--ref-image', a, '--ref-image', b, '--ref-audio', mp3],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    const body = fake.creations[0].body
    assert.equal(body.mode, 'reference')
    assert.equal(body.images.length, 2)
    assert.ok(body.images[0].startsWith('data:image/png;base64,'))
    assert.equal(body.audios.length, 1)
    assert.ok(body.audios[0].startsWith('data:audio/mpeg;base64,'))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('2.5-flash 参考图超过 5 张：本地拦截（零创建）', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, a } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const six = ['--ref-image', a, '--ref-image', a, '--ref-image', a, '--ref-image', a, '--ref-image', a, '--ref-image', a]
    const r = await run(['video', '一只猫', ...six], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /最多 5 张/)
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('2.5-flash 不支持参考视频：本地拦截并说明仅 2.5 支持', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, mp4 } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '一只猫', '--ref-video', mp4], { env: { HOME: home.dir }, cwd: cwd.dir })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /agnes-video-2\.5/)
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('keyframe 与参考素材互斥：本地拦截', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, a, mp3 } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(['video', '一只猫', '--first-frame', a, '--ref-audio', mp3], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /互斥/)
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('收费模型 2.5：显式点名可用，参考视频（含起始秒）到达，运行前打印预估费用', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, mp4 } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(
      [
        'video',
        '续写这个镜头',
        '--model',
        'agnes-video-2.5',
        '--ref-video',
        mp4,
        '--video-start',
        '2',
        '--size',
        '2K',
      ],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    assert.match(r.stderr, /预估费用/)
    assert.match(r.stderr, /0\.275/)
    const body = fake.creations[0].body
    assert.equal(body.mode, 'reference')
    assert.equal(body.size, '2K')
    assert.equal(body.videos.length, 1)
    assert.equal(body.videos[0].start_seconds, 2)
    assert.ok(body.videos[0].url.startsWith('data:video/mp4;base64,'))
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('v2.0：ti2vid 模式，帧数/帧率/分辨率→宽高 正确到达', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(
      [
        'video',
        '一只猫在跑',
        '--model',
        'agnes-video-v2.0',
        '--num-frames',
        '121',
        '--frame-rate',
        '24',
        '--size',
        '720p',
        '--ratio',
        '9:16',
      ],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    const body = fake.creations[0].body
    assert.equal(body.mode, 'ti2vid')
    assert.equal(body.num_frames, 121)
    assert.equal(body.frame_rate, 24)
    assert.equal(body.width, 720)
    assert.equal(body.height, 1280)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('v2.0 首尾帧：keyframes 模式（extra_body 嵌套）', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, a, b } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)

    const r = await run(
      ['video', '转场动画', '--model', 'agnes-video-v2.0', '--first-frame', a, '--last-frame', b],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    const body = fake.creations[0].body
    assert.equal(body.mode, undefined)
    assert.equal(body.extra_body.mode, 'keyframes')
    assert.equal(body.extra_body.image.length, 2)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('v2.0 参数非法：帧数超限/不满足 8n+1、帧率越界、seconds 不适用', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)
    const base = ['video', '一只猫', '--model', 'agnes-video-v2.0']

    for (const [args, pattern] of [
      [['--num-frames', '442'], /441/],
      [['--num-frames', '120'], /8n\+1/],
      [['--frame-rate', '61'], /1–60/],
      [['--seconds', '5'], /--num-frames/],
    ]) {
      const r = await run([...base, ...args], { env: { HOME: home.dir }, cwd: cwd.dir })
      assert.equal(r.code, 2, `参数 ${args} 应被拦截`)
      assert.match(r.stderr, pattern)
    }
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
