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
  return { cwd, png, a, b, mp3 }
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

test('只传尾帧会在本地拒绝', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd, b } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)
    const r = await run(['video', '转场', '--last-frame', b], {
      env: { HOME: home.dir },
      cwd: cwd.dir,
    })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--first-frame/)
    assert.equal(fake.creations.length, 0)
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

test('已移除的参考视频与帧控制参数：本地拦截（零创建）', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    for (const option of ['--ref-video', '--video-start', '--num-frames', '--frame-rate']) {
      const r = await run(['video', '一只猫', option, '1'], { env: { HOME: home.dir }, cwd: cwd.dir })
      assert.equal(r.code, 2)
      assert.match(r.stderr, new RegExp(`未知参数 ${option}`))
    }
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

test('退役与收费视频模型在本地拦截（零创建）', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t)
    agnesConfig(home, `${fake.url}/v1`)

    for (const [model, pattern] of [
      ['agnes-video-v2.0', /退役/],
      ['agnes-video-2.5', /收费模型/],
    ]) {
      const r = await run(['video', '一只猫', '--model', model], { env: { HOME: home.dir }, cwd: cwd.dir })
      assert.equal(r.code, 2)
      assert.match(r.stderr, pattern)
    }
    assert.equal(fake.creations.length, 0)
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})

test('未知 Agnes 视频模型会透传 seconds、size、ratio，不静默丢参数', async (t) => {
  const home = tmpDir('sgen-home-')
  const { cwd } = mediaSetup(t, home)
  try {
    const fake = await fakeAgnesVideo(t, { completeAfterPolls: 1 })
    agnesConfig(home, `${fake.url}/v1`)
    const r = await run(
      ['video', '未来模型', '--model', 'agnes-video-3.0-flash', '--seconds', '7', '--size', '1080P', '--ratio', '16:9'],
      { env: { HOME: home.dir }, cwd: cwd.dir },
    )
    assert.equal(r.code, 0)
    assert.match(r.stderr, /无法判断是否收费/)
    const body = fake.creations[0].body
    assert.equal(body.seconds, '7')
    assert.equal(body.size, '1080P')
    assert.equal(body.aspect_ratio, '16:9')
  } finally {
    home.cleanup()
    cwd.cleanup()
  }
})
