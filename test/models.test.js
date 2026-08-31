import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from './helpers/run.js'

const ALL_MODELS = [
  'sensenova-u1.5-lite',
  'sensenova-u1-fast',
  'agnes-image-2.1-flash',
  'agnes-image-2.0-flash',
  'agnes-video-v2.0',
  'agnes-video-2.5-flash',
  'agnes-video-2.5',
]

test('sgen models 列出全部 7 个内置模型及关键能力信息', async () => {
  const r = await run(['models'])
  assert.equal(r.code, 0)
  for (const id of ALL_MODELS) {
    assert.ok(r.stdout.includes(id), `输出应包含模型 ${id}：\n${r.stdout}`)
  }
  assert.match(r.stdout, /商汤/)
  assert.match(r.stdout, /Agnes/)
  assert.match(r.stdout, /免费/)
  assert.match(r.stdout, /收费/)
  // 默认模型有明确标注
  assert.match(r.stdout, /默认/)
  assert.match(r.stdout, /sensenova-u1\.5-lite/)
})

test('--help 用法面与实际参数一致：video 与 status 的全部选项都列出', async () => {
  const r = await run(['--help'])
  assert.equal(r.code, 0)
  // video 支持但此前未写进用法的选项
  for (const opt of ['--model', '--out', '--json', '--video-start']) {
    assert.ok(r.stdout.includes(opt), `video 用法应包含 ${opt}`)
  }
  // status 的选项此前完全没写进用法
  assert.match(r.stdout, /status 选项：/)
  for (const opt of ['--wait', '--timeout', '--out', '--json']) {
    assert.ok(r.stdout.includes(opt), `status 用法应包含 ${opt}`)
  }
})
