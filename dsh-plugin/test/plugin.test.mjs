import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { normalizeConfig } from '../lib/config.js'
import { apply } from '../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FAKE_CLI = path.join(HERE, 'fixtures', 'fake-sgen.mjs')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

class CaptureResponse extends Writable {
  constructor() {
    super()
    this.chunks = []
    this.headersSent = false
    this.statusCode = 0
    this.headers = {}
    this.finished = new Promise((resolve, reject) => {
      this.once('finish', resolve)
      this.once('error', reject)
    })
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode
    this.headers = { ...headers }
    this.headersSent = true
    return this
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk))
    callback()
  }

  get body() {
    return Buffer.concat(this.chunks)
  }
}

function makeTemp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-sgen-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function makeRepo(temp) {
  const repo = path.join(temp, 'sgen')
  fs.mkdirSync(path.join(repo, 'bin'), { recursive: true })
  fs.mkdirSync(path.join(repo, 'skill', 'sgen'), { recursive: true })
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true })
  fs.writeFileSync(path.join(repo, 'bin', 'sgen.js'), '// fake entry\n')
  fs.writeFileSync(
    path.join(repo, 'src', 'catalog.js'),
    `export const PROVIDERS = {
      sensenova: { base_url: 'https://catalog-sensenova.example.com/v1' },
      agnes: { base_url: 'https://catalog-agnes.example.com/v1' },
    }
    export const DEFAULT_IMAGE_MODEL = 'catalog-image-default'
    export const DEFAULT_VIDEO_MODEL = 'catalog-video-default'
    `,
  )
  fs.writeFileSync(
    path.join(repo, 'src', 'config.js'),
    `import { PROVIDERS } from './catalog.js'
    export const DEFAULT_BASE_URLS = {
      sensenova: PROVIDERS.sensenova.base_url,
      agnes: PROVIDERS.agnes.base_url,
    }
    export const AGNES_REGIONS = {
      international: PROVIDERS.agnes.base_url,
      china: 'https://catalog-agnes-china.example.com/v1',
    }
    `,
  )
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    `${JSON.stringify({ name: 'sgen', version: '9.9.9', bin: { sgen: 'bin/sgen.js' } }, null, 2)}\n`,
  )
  fs.writeFileSync(
    path.join(repo, 'skill', 'sgen', 'SKILL.md'),
    ['---', 'name: sgen', 'description: 测试用 sgen 技能', '---', '', '原始技能正文。', ''].join('\n'),
  )
  return repo
}

function makeCtx() {
  const toolMap = new Map()
  const skills = []
  const routes = new Map()
  const effects = []
  const webServer = {
    getOrigin: () => 'http://127.0.0.1:12345',
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  }
  const skillsService = {
    register(skill) {
      skills.push(skill)
      return () => {}
    },
  }
  const ctx = {
    tools: {
      register(definition) {
        toolMap.set(definition.name, definition)
        return () => toolMap.delete(definition.name)
      },
    },
    skills: skillsService,
    get(name) {
      if (name === 'skills') return skillsService
      if (name === 'webServer') return webServer
      return undefined
    },
    inject(_services, callback) {
      return callback(ctx)
    },
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
    logger: { info() {}, warn() {}, error() {} },
    toolMap,
    skills,
    routes,
    effects,
    webServer,
  }
  return ctx
}

function setup(t) {
  const temp = makeTemp(t)
  const oldHome = process.env.HOME
  process.env.HOME = temp
  t.after(() => {
    if (oldHome === undefined) delete process.env.HOME
    else process.env.HOME = oldHome
  })
  const repo = makeRepo(temp)
  const workspacePath = path.join(temp, 'workspace')
  fs.mkdirSync(workspacePath, { recursive: true })
  // macOS 的 /var 是 /private/var 的软链；子进程 cwd 会返回真实路径。
  const workspace = fs.realpathSync(workspacePath)
  const historyFile = path.join(temp, 'gallery.json')
  const argsFile = path.join(temp, 'args.jsonl')
  const ctx = makeCtx()
  apply(ctx, {
    sgenRoot: repo,
    sgenBin: FAKE_CLI,
    nodePath: process.execPath,
    historyFile,
    maxHistory: 100,
    updateCheck: false,
    env: { SGEN_FAKE_ARGS_FILE: argsFile },
  })
  const exec = {
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: workspace } } },
  }
  return { temp, repo, workspace, historyFile, argsFile, ctx, exec }
}

function call(ctx, name, args, exec) {
  const tool = ctx.toolMap.get(name)
  assert.ok(tool, `工具未注册：${name}`)
  return tool.execute(args, exec)
}

function readHistory(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).items
  } catch {
    return []
  }
}

function readArgs(file) {
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

test('注册工具、技能和面板路由', (t) => {
  const { ctx } = setup(t)
  assert.deepEqual([...ctx.toolMap.keys()].sort(), [
    'sgen_config',
    'sgen_image',
    'sgen_models',
    'sgen_status',
    'sgen_video',
  ])
  assert.equal(ctx.skills.length, 1)
  assert.equal(ctx.skills[0].name, 'sgen')
  assert.equal(ctx.skills[0].source, 'dsh-sgen')
  assert.match(ctx.skills[0].content, /DSH 插件版/)
  assert.match(ctx.skills[0].content, /原始技能正文/)
  const videoProperties = ctx.toolMap.get('sgen_video').parameters.properties
  for (const removed of ['ref_videos', 'video_start', 'num_frames', 'frame_rate']) {
    assert.equal(videoProperties[removed], undefined, `视频工具不应再暴露 ${removed}`)
  }
  assert.ok(ctx.routes.has('/sgen/state'))
  assert.ok(ctx.routes.has('/sgen/config'))
  assert.ok(ctx.routes.has('/sgen/generate'))
  assert.ok(ctx.routes.has('/sgen/file'))
})

test('sgen_image 生成图片、保留警告并写入作品索引', async (t) => {
  const { ctx, exec, workspace, historyFile, argsFile } = setup(t)
  const value = await call(ctx, 'sgen_image', { prompt: '一只戴宇航头盔的橘猫', size: '2K', ratio: '16:9' }, exec)
  assert.equal(value.ok, true)
  assert.equal(value.model, 'fake-image-model')
  assert.equal(value.size, '2K')
  assert.equal(value.ratio, '16:9')
  assert.equal(value.file, path.join(workspace, 'fake-image.png'))
  assert.match(value.warnings, /fake warning/)
  assert.equal(value.image, undefined)

  const items = readHistory(historyFile)
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'image')
  assert.equal(items[0].file, value.file)
  assert.equal(items[0].prompt, '一只戴宇航头盔的橘猫')

  const argv = readArgs(argsFile).at(-1)
  assert.equal(argv[0], 'image')
  assert.equal(argv[argv.length - 1], '一只戴宇航头盔的橘猫')
  assert.equal(argv[argv.length - 2], '--')
  assert.ok(argv.includes('--json'))
  assert.equal(argv[argv.indexOf('--size') + 1], '2K')
  assert.equal(argv[argv.indexOf('--ratio') + 1], '16:9')
})

test('sgen_image 把 CLI 的 JSON 错误转成工具错误', async (t) => {
  const { ctx, exec, historyFile } = setup(t)
  await assert.rejects(
    () => call(ctx, 'sgen_image', { prompt: '这张会失败' }, exec),
    /模拟失败：远端拒绝/,
  )
  assert.equal(readHistory(historyFile).length, 0)
})

test('sgen_video 等待出片并登记视频', async (t) => {
  const { ctx, exec, workspace, historyFile, argsFile } = setup(t)
  const value = await call(ctx, 'sgen_video', { prompt: '日落海滩航拍', seconds: 8 }, exec)
  assert.equal(value.ok, true)
  assert.equal(value.model, 'fake-video-model')
  assert.equal(value.seconds, 8)
  assert.equal(value.status, 'completed')
  assert.equal(value.file, path.join(workspace, 'fake-video.mp4'))

  const items = readHistory(historyFile)
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'video')
  assert.equal(items[0].video_id, 'vid-1')

  const argv = readArgs(argsFile).at(-1)
  assert.equal(argv[0], 'video')
  assert.equal(argv[argv.indexOf('--seconds') + 1], '8')
  assert.equal(argv[argv.length - 1], '日落海滩航拍')
})

test('sgen_video no_wait 只返回任务号，sgen_status 再续等下载', async (t) => {
  const { ctx, exec, workspace, historyFile } = setup(t)
  const submitted = await call(ctx, 'sgen_video', { prompt: '长任务', no_wait: true }, exec)
  assert.equal(submitted.ok, true)
  assert.equal(submitted.video_id, 'vid-1')
  assert.equal(submitted.file, undefined)
  assert.match(submitted.hint, /sgen status/)
  assert.equal(readHistory(historyFile).length, 0)

  const pending = await call(ctx, 'sgen_status', { video_id: 'vid-pending' }, exec)
  assert.equal(pending.status, 'running')
  assert.equal(pending.progress, 42)
  assert.equal(pending.file, undefined)

  const done = await call(ctx, 'sgen_status', { video_id: 'vid-1', wait: true }, exec)
  assert.equal(done.status, 'completed')
  assert.equal(done.file, path.join(workspace, 'fake-status.mp4'))
  assert.equal(readHistory(historyFile).length, 1)
})

test('sgen_models 有缓存，sgen_config 能列出配置并测试连通性', async (t) => {
  const { ctx, exec, argsFile } = setup(t)
  const first = await call(ctx, 'sgen_models', {}, exec)
  assert.equal(first.ok, true)
  assert.match(first.text, /fake-image-model/)
  const second = await call(ctx, 'sgen_models', {}, exec)
  assert.equal(second.cached, true)

  const list = await call(ctx, 'sgen_config', { action: 'list' }, exec)
  assert.equal(list.ok, true)
  assert.match(list.text, /商汤/)
  assert.match(list.text, /Agnes/)

  const check = await call(ctx, 'sgen_config', { action: 'test' }, exec)
  assert.equal(check.ok, true)
  assert.equal(check.results.length, 1)
  assert.equal(check.results[0].status, 'ok')
  assert.match(check.text, /连通/)

  // config test 必须带 --json，且不能被误当成位置参数
  const argv = readArgs(argsFile).at(-1)
  assert.deepEqual(argv, ['config', 'test', '--json'])
})

test('两家服务商的独立 Key 可以一次保存', async (t) => {
  const { ctx, temp, argsFile } = setup(t)
  const snKey = 'sk-independent-sensenova'
  const agnesKey = 'ak-independent-agnes'
  const request = Readable.from([JSON.stringify({
    api_keys: { sensenova: snKey, agnes: agnesKey },
  })])
  request.method = 'POST'
  request.url = '/sgen/config'
  request.headers = { host: '127.0.0.1:12345', 'content-type': 'application/json' }
  const response = new CaptureResponse()
  await ctx.routes.get('/sgen/config').handler(request, response)
  await response.finished

  assert.equal(response.statusCode, 200)
  assert.ok(!response.body.toString('utf8').includes(snKey))
  assert.ok(!response.body.toString('utf8').includes(agnesKey))
  const config = JSON.parse(fs.readFileSync(path.join(temp, '.sgen', 'config.json'), 'utf8'))
  assert.deepEqual(config.providers.sensenova.api_keys, [snKey])
  assert.deepEqual(config.providers.agnes.api_keys, [agnesKey])
  assert.deepEqual(readArgs(argsFile).find((argv) => argv[0] === 'config' && argv[1] === 'set'), [
    'config',
    'set',
    'sensenova.api_keys',
    snKey,
    'agnes.api_keys',
    agnesKey,
  ])
})

test('侧栏保存 Key、Base URL 和默认模型，响应不回传 Key', async (t) => {
  const { ctx, temp, argsFile } = setup(t)
  const route = ctx.routes.get('/sgen/config')

  async function post(payload, host = '127.0.0.1:12345') {
    const request = Readable.from([JSON.stringify(payload)])
    request.method = 'POST'
    request.url = '/sgen/config'
    request.headers = { host, 'content-type': 'application/json' }
    const response = new CaptureResponse()
    await route.handler(request, response)
    await response.finished
    return response
  }

  const secret = 'ak-sidebar-secret'
  const saved = await post({
    provider: 'agnes',
    api_key: secret,
    base_url: 'https://sidebar.example.com/v1/',
    default_image_model: 'agnes-image-2.5-flash',
    default_video_model: 'agnes-video-2.5-flash',
  })
  assert.equal(saved.statusCode, 200)
  assert.ok(!saved.body.toString('utf8').includes(secret))
  const state = JSON.parse(saved.body.toString('utf8')).data
  assert.equal(state.providers.agnes.keys, 1)
  assert.equal(state.providers.agnes.base_url, 'https://sidebar.example.com/v1/')
  assert.equal(state.default_models.image, 'agnes-image-2.5-flash')
  assert.equal(state.default_models.video, 'agnes-video-2.5-flash')

  const config = JSON.parse(fs.readFileSync(path.join(temp, '.sgen', 'config.json'), 'utf8'))
  assert.deepEqual(config.providers.agnes.api_keys, [secret])
  assert.equal(config.default_image_model, 'agnes-image-2.5-flash')
  const calls = readArgs(argsFile)
  assert.deepEqual(calls.find((argv) => argv[0] === 'config' && argv[1] === 'set'), [
    'config',
    'set',
    'agnes.api_keys',
    secret,
    'agnes.base_url',
    'https://sidebar.example.com/v1/',
    'default_image_model',
    'agnes-image-2.5-flash',
    'default_video_model',
    'agnes-video-2.5-flash',
  ])
  assert.ok(calls.some((argv) => argv.join(' ') === 'config list --json'))
  assert.ok(calls.some((argv) => argv.join(' ') === 'models --json'))

  const reset = await post({
    provider: 'agnes',
    api_key: '',
    base_url: '',
    default_image_model: '',
    default_video_model: '',
  })
  assert.equal(reset.statusCode, 200)
  const resetConfig = JSON.parse(fs.readFileSync(path.join(temp, '.sgen', 'config.json'), 'utf8'))
  assert.deepEqual(resetConfig.providers.agnes.api_keys, [secret], 'Key 留空必须保留原值')
  assert.equal(resetConfig.providers.agnes.base_url, undefined)
  assert.equal(resetConfig.default_image_model, undefined)
  assert.equal(resetConfig.default_video_model, undefined)

  const beforeDenied = readArgs(argsFile).length
  const denied = await post({ provider: 'agnes', api_key: 'must-not-save' }, 'evil.example:12345')
  assert.equal(denied.statusCode, 403)
  assert.equal(readArgs(argsFile).length, beforeDenied)
})

test('面板摘要显示正在生效的内置默认地址和模型', async (t) => {
  const { ctx, temp } = setup(t)
  const configDir = path.join(temp, '.sgen')
  fs.mkdirSync(configDir, { recursive: true })
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify({
      providers: {
        sensenova: { api_keys: ['sk-test'] },
        agnes: { api_keys: ['ak-test'] },
      },
    }),
  )

  const response = new CaptureResponse()
  await ctx.routes.get('/sgen/state').handler(
    { method: 'GET', url: '/sgen/state', headers: { host: '127.0.0.1:12345' } },
    response,
  )
  await response.finished
  assert.equal(response.statusCode, 200)
  const state = JSON.parse(response.body.toString('utf8')).data
  assert.equal(state.providers.sensenova.keys, 1)
  assert.equal(state.providers.agnes.keys, 1)
  assert.equal(state.providers.sensenova.base_url, 'https://catalog-sensenova.example.com/v1')
  assert.equal(state.providers.agnes.base_url, 'https://catalog-agnes.example.com/v1')
  assert.equal(state.default_models.image, 'catalog-image-default')
  assert.equal(state.default_models.video, 'catalog-video-default')
  assert.equal(state.models.length, 4)
  assert.equal(state.models.filter((model) => model.provider === 'sensenova').length, 2)
  assert.equal(state.models.filter((model) => model.provider === 'agnes' && model.type === 'video').length, 1)
})

test('试验场生成图片：参考图、参数、产物索引和文件预览形成闭环', async (t) => {
  const { ctx, temp, historyFile, argsFile } = setup(t)
  const request = Readable.from([JSON.stringify({
    kind: 'image',
    prompt: '试验场图片',
    model: 'fake-image-model',
    size: '2K',
    ratio: '16:9',
    images: [{ data_url: `data:image/png;base64,${PNG.toString('base64')}` }],
  })])
  request.method = 'POST'
  request.url = '/sgen/generate'
  request.headers = { host: '127.0.0.1:12345', 'content-type': 'application/json' }
  const response = new CaptureResponse()
  await ctx.routes.get('/sgen/generate').handler(request, response)
  await response.finished

  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body.toString('utf8'))
  assert.equal(body.ok, true)
  assert.equal(body.item.kind, 'image')
  assert.equal(body.item.source, 'playground')
  assert.equal(body.item.prompt, '试验场图片')
  assert.ok(fs.existsSync(body.item.file))
  assert.equal(fs.realpathSync(path.dirname(body.item.file)), fs.realpathSync(path.join(temp, 'sgen')))
  assert.equal(readHistory(historyFile)[0].id, body.item.id)

  const argv = readArgs(argsFile).find((args) => args[0] === 'image')
  assert.equal(argv[argv.indexOf('--size') + 1], '2K')
  assert.equal(argv[argv.indexOf('--ratio') + 1], '16:9')
  const reference = argv[argv.indexOf('--image') + 1]
  assert.ok(reference.includes('sgen-dsh-playground-'))
  assert.equal(fs.existsSync(reference), false, '生成结束后应清理参考图临时副本')

  const fileResponse = new CaptureResponse()
  await ctx.routes.get('/sgen/file').handler(
    { method: 'GET', url: `/sgen/file?id=${body.item.id}`, headers: { host: '127.0.0.1:12345' } },
    fileResponse,
  )
  await fileResponse.finished
  assert.equal(fileResponse.statusCode, 200)
  assert.deepEqual(fileResponse.body, PNG)

  const deleted = new CaptureResponse()
  await ctx.routes.get('/sgen/file').handler(
    { method: 'DELETE', url: `/sgen/file?id=${body.item.id}`, headers: { host: '127.0.0.1:12345' } },
    deleted,
  )
  await deleted.finished
  assert.equal(deleted.statusCode, 200)
  assert.equal(fs.existsSync(body.item.file), false)
  assert.equal(readHistory(historyFile).length, 0)

  const missing = new CaptureResponse()
  await ctx.routes.get('/sgen/file').handler(
    { method: 'DELETE', url: `/sgen/file?id=${body.item.id}`, headers: { host: '127.0.0.1:12345' } },
    missing,
  )
  await missing.finished
  assert.equal(missing.statusCode, 200)
  assert.equal(JSON.parse(missing.body.toString('utf8')).already_deleted, true)
})

test('产物目录可修改并持久化到插件设置', async (t) => {
  const { ctx, temp } = setup(t)
  const request = Readable.from([JSON.stringify({ playground_dir: '~/custom-sgen-output' })])
  request.method = 'POST'
  request.url = '/sgen/config'
  request.headers = { host: '127.0.0.1:12345', 'content-type': 'application/json' }
  const response = new CaptureResponse()
  await ctx.routes.get('/sgen/config').handler(request, response)
  await response.finished

  assert.equal(response.statusCode, 200)
  const expected = path.join(temp, 'custom-sgen-output')
  const body = JSON.parse(response.body.toString('utf8'))
  assert.equal(body.data.playground_dir, expected)
  const saved = JSON.parse(fs.readFileSync(path.join(temp, '.sgen', 'dsh-plugin.json'), 'utf8'))
  assert.equal(saved.playground_dir, expected)
  const restored = normalizeConfig({}, { here: path.join(temp, 'plugin', 'lib') })
  assert.equal(restored.playgroundDir, expected, '重新加载插件后应恢复目录')
})

test('试验场生成视频并校验时长参数，空提示词不启动 CLI', async (t) => {
  const { ctx, historyFile, argsFile } = setup(t)
  async function post(payload) {
    const request = Readable.from([JSON.stringify(payload)])
    request.method = 'POST'
    request.url = '/sgen/generate'
    request.headers = { host: '127.0.0.1:12345', 'content-type': 'application/json' }
    const response = new CaptureResponse()
    await ctx.routes.get('/sgen/generate').handler(request, response)
    await response.finished
    return response
  }

  const response = await post({ kind: 'video', prompt: '试验场视频', model: 'fake-video-model', seconds: 8 })
  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.body.toString('utf8'))
  assert.equal(body.item.kind, 'video')
  assert.equal(body.item.seconds, 8)
  assert.equal(readHistory(historyFile).length, 1)
  const argv = readArgs(argsFile).find((args) => args[0] === 'video')
  assert.equal(argv[argv.indexOf('--seconds') + 1], '8')

  const before = readArgs(argsFile).length
  const invalid = await post({ kind: 'image', prompt: '  ' })
  assert.equal(invalid.statusCode, 400)
  assert.equal(readArgs(argsFile).length, before)
})

test('面板路由返回状态和图片字节，并拒绝非同源请求', async (t) => {
  const { ctx, exec, workspace } = setup(t)
  const value = await call(ctx, 'sgen_image', { prompt: '面板测试图' }, exec)
  const stateRoute = ctx.routes.get('/sgen/state')
  const fileRoute = ctx.routes.get('/sgen/file')

  const stateResponse = new CaptureResponse()
  await stateRoute.handler(
    { method: 'GET', url: '/sgen/state', headers: { host: '127.0.0.1:12345' } },
    stateResponse,
  )
  await stateResponse.finished
  assert.equal(stateResponse.statusCode, 200)
  const stateBody = JSON.parse(stateResponse.body.toString('utf8'))
  assert.equal(stateBody.ok, true)
  assert.equal(stateBody.data.version, '9.9.9')
  assert.equal(stateBody.data.items.length, 1)
  assert.equal(stateBody.data.items[0].id.length, 16)
  assert.equal(stateBody.data.providers.sensenova.keys, 0)

  const fileResponse = new CaptureResponse()
  await fileRoute.handler(
    {
      method: 'GET',
      url: `/sgen/file?id=${encodeURIComponent(stateBody.data.items[0].id)}`,
      headers: { host: '127.0.0.1:12345' },
    },
    fileResponse,
  )
  await fileResponse.finished
  assert.equal(fileResponse.statusCode, 200)
  assert.equal(fileResponse.headers['content-type'], 'image/png')
  assert.deepEqual(fileResponse.body, fs.readFileSync(path.join(workspace, 'fake-image.png')))

  const badResponse = new CaptureResponse()
  await stateRoute.handler(
    { method: 'GET', url: '/sgen/state', headers: { host: 'evil.example:12345' } },
    badResponse,
  )
  await badResponse.finished
  assert.equal(badResponse.statusCode, 403)
})

test('作品索引按文件去重并遵守 maxHistory', async (t) => {
  const { exec, workspace } = setup(t)
  // 这个测试单独把 maxHistory 调小，重新 apply 一次
  const temp = path.dirname(workspace)
  const repo = path.join(temp, 'sgen')
  const smallHistory = path.join(temp, 'small-gallery.json')
  const smallCtx = makeCtx()
  apply(smallCtx, {
    sgenRoot: repo,
    sgenBin: FAKE_CLI,
    nodePath: process.execPath,
    historyFile: smallHistory,
    maxHistory: 2,
    updateCheck: false,
  })
  const a = path.join(workspace, 'a.png')
  const b = path.join(workspace, 'b.png')
  const c = path.join(workspace, 'c.png')
  await call(smallCtx, 'sgen_image', { prompt: 'a', out: a }, exec)
  await call(smallCtx, 'sgen_image', { prompt: 'b', out: b }, exec)
  await call(smallCtx, 'sgen_image', { prompt: 'c', out: c }, exec)
  let items = readHistory(smallHistory)
  assert.equal(items.length, 2)
  assert.deepEqual(items.map((item) => path.basename(item.file)).sort(), ['b.png', 'c.png'])

  // 重复生成同一个文件只保留一条，并移到最前
  await call(smallCtx, 'sgen_image', { prompt: 'a again', out: a }, exec)
  items = readHistory(smallHistory)
  assert.equal(items.length, 2)
  assert.equal(items[0].file, path.resolve(a))
  assert.equal(items[0].prompt, 'a again')
})

test('提示词为空时本地报错，不启动 CLI', async (t) => {
  const { ctx, exec, argsFile } = setup(t)
  await assert.rejects(() => call(ctx, 'sgen_image', { prompt: '   ' }, exec), /prompt 不能为空/)
  assert.equal(readArgs(argsFile).length, 0)
})
