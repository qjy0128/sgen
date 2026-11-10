import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './helpers/run.js'

const ALL_MODELS = [
  'sensenova-u1.5-lite',
  'sensenova-u1.5-fast',
  'agnes-image-2.5-flash',
  'agnes-image-2.1-flash',
  'agnes-image-2.0-flash',
  'agnes-video-2.5-flash',
]

test('sgen models 列出全部 6 个内置免费模型及关键能力信息', async () => {
  const r = await run(['models'])
  assert.equal(r.code, 0)
  for (const id of ALL_MODELS) {
    assert.ok(r.stdout.includes(id), `输出应包含模型 ${id}：\n${r.stdout}`)
  }
  assert.match(r.stdout, /商汤/)
  assert.match(r.stdout, /Agnes/)
  assert.match(r.stdout, /免费/)
  assert.doesNotMatch(r.stdout, /收费/)
  assert.doesNotMatch(r.stdout, /agnes-video-v2\.0/)
  assert.match(r.stdout, /默认/)
  assert.match(r.stdout, /sensenova-u1\.5-lite/)
})

test('sgen models --json 按供应商和类型输出结构化模型目录', async () => {
  const r = await run(['models', '--json'])
  assert.equal(r.code, 0)
  const data = JSON.parse(r.stdout)
  assert.equal(data.ok, true)
  assert.equal(data.models.length, ALL_MODELS.length)
  for (const id of ALL_MODELS) {
    assert.ok(data.models.some((model) => model.id === id), `JSON 应包含 ${id}`)
  }
  const lite = data.models.find((model) => model.id === 'sensenova-u1.5-lite')
  assert.equal(lite.provider, 'sensenova')
  assert.equal(lite.defaultSize, 'auto')
  assert.deepEqual(lite.sizeTiers, ['auto', '1K', '2K', '4K'])
  const video = data.models.find((model) => model.id === 'agnes-video-2.5-flash')
  assert.equal(video.type, 'video')
  assert.equal(video.referenceImages, true)
  assert.deepEqual(video.seconds, { min: 4, max: 12, default: 5 })
  const fast = data.models.find((model) => model.id === 'sensenova-u1.5-fast')
  assert.equal(fast.referenceImages, false)
  assert.deepEqual(fast.sizeTiers, ['1K', '2K'])
  assert.ok(data.models.every((model) => typeof model.id === 'string' && typeof model.provider === 'string'))
})

test('--help 用法面与实际参数一致：video 与 status 的全部选项都列出', async () => {
  const r = await run(['--help'])
  assert.equal(r.code, 0)
  for (const opt of ['--model', '--out', '--force', '--json', '--ref-image', '--ref-audio']) {
    assert.ok(r.stdout.includes(opt), `video 用法应包含 ${opt}`)
  }
  for (const removed of ['--ref-video', '--video-start', '--num-frames', '--frame-rate']) {
    assert.ok(!r.stdout.includes(removed), `video 用法不应再包含 ${removed}`)
  }
  assert.match(r.stdout, /status 选项：/)
  for (const opt of ['--wait', '--timeout', '--out', '--force', '--json']) {
    assert.ok(r.stdout.includes(opt), `status 用法应包含 ${opt}`)
  }
})
