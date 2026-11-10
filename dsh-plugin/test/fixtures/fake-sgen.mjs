/**
 * 测试用假 CLI：不访问网络，只按参数写本地文件和 JSON。
 * 通过 SGEN_FAKE_ARGS_FILE 把收到的 argv 追加到文件，供测试断言参数拼装。
 */
import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
if (process.env.SGEN_FAKE_ARGS_FILE) {
  fs.appendFileSync(process.env.SGEN_FAKE_ARGS_FILE, `${JSON.stringify(argv)}\n`)
}

const args = argv.slice(1)
const flags = new Map()
const booleans = new Set()
const positionals = []
for (let index = 0; index < args.length; index += 1) {
  const item = args[index]
  if (item === '--') {
    positionals.push(...args.slice(index + 1))
    break
  }
  if (item.startsWith('--')) {
    const key = item.slice(2)
    if (['force', 'json', 'no-wait', 'wait'].includes(key)) {
      booleans.add(key)
      continue
    }
    flags.set(key, args[index + 1])
    index += 1
  } else {
    positionals.push(item)
  }
}

// 1x1 透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

function outFile(extension, fallback) {
  const out = flags.get('out')
  if (!out) return path.join(process.cwd(), fallback)
  if (out.endsWith('/') || out.endsWith(path.sep)) {
    return path.join(out, fallback)
  }
  return path.isAbsolute(out) ? out : path.resolve(process.cwd(), out)
}

function writeOut(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
  return path.resolve(file)
}

function print(value, code = 0) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
  process.exit(code)
}

const command = argv[0]
const prompt = positionals.join(' ')
const promptText = positionals[positionals.length - 1] ?? ''

if (command === 'models') {
  if (booleans.has('json')) {
    print({
      ok: true,
      models: [
        { id: 'fake-image-model', provider: 'sensenova', type: 'image', free: true, sync: true, isDefault: true },
        { id: 'fake-image-alt', provider: 'sensenova', type: 'image', free: true, sync: true, isDefault: false },
        { id: 'fake-agnes-image', provider: 'agnes', type: 'image', free: true, sync: true, isDefault: false },
        { id: 'fake-video-model', provider: 'agnes', type: 'video', free: true, sync: false, isDefault: true },
      ],
    })
  }
  process.stdout.write(
    ['图片模型：', '  fake-image-model  免费·同步  文生图/图生图', '视频模型：', '  fake-video-model  免费·异步  文生视频', ''].join('\n'),
  )
  process.exit(0)
}

if (command === 'image') {
  if (promptText.includes('失败')) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { kind: 'api', message: '模拟失败：远端拒绝' }, exit_code: 1 })}\n`,
    )
    process.exit(1)
  }
  const file = writeOut(outFile('png', 'fake-image.png'), PNG)
  process.stderr.write('正在生成图片（fake-image-model）…\n⚠ fake warning：这是测试提示\n')
  print({
    ok: true,
    model: 'fake-image-model',
    size: flags.get('size') ?? null,
    ratio: flags.get('ratio') ?? null,
    file,
    elapsed_ms: 12,
  })
}

if (command === 'video') {
  if (booleans.has('no-wait')) {
    process.stderr.write('正在创建视频任务（fake-video-model，text 模式）…\n任务已创建：video_id=vid-1\n')
    print({
      ok: true,
      model: 'fake-video-model',
      video_id: 'vid-1',
      status: 'queued',
      mode: 'text',
      size: '720P',
      ratio: '16:9',
      seconds: Number(flags.get('seconds') ?? 5),
      hint: '运行 sgen status vid-1 --wait 继续等待并下载',
    })
  }
  const file = writeOut(outFile('mp4', 'fake-video.mp4'), Buffer.from('fake video'))
  process.stderr.write('  任务状态：running\n  任务状态：completed\n')
  print({
    ok: true,
    model: 'fake-video-model',
    video_id: 'vid-1',
    status: 'completed',
    mode: 'text',
    file,
    elapsed_ms: 34,
    size: '720P',
    ratio: '16:9',
    seconds: Number(flags.get('seconds') ?? 5),
  })
}

if (command === 'status') {
  if (booleans.has('wait')) {
    const file = writeOut(outFile('mp4', 'fake-status.mp4'), Buffer.from('fake status video'))
    print({
      ok: true,
      model: 'fake-video-model',
      video_id: positionals[0] || 'vid-1',
      status: 'completed',
      file,
    })
  }
  if (positionals[0] === 'vid-pending') {
    print({
      ok: true,
      model: 'fake-video-model',
      video_id: 'vid-pending',
      status: 'running',
      progress: 42,
    })
  }
  print({
    ok: true,
    model: 'fake-video-model',
    video_id: positionals[0] || 'vid-1',
    status: 'completed',
    file: writeOut(outFile('mp4', 'fake-status.mp4'), Buffer.from('fake status video')),
  })
}

if (command === 'config') {
  const sub = argv[1]
  if (sub === 'set') {
    const file = path.join(process.env.HOME, '.sgen', 'config.json')
    const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
    const pairs = argv.slice(2)
    for (let index = 0; index < pairs.length; index += 2) {
      const keyPath = pairs[index]
      let value = pairs[index + 1]
      const [provider, field] = keyPath.split('.')
      if (keyPath.endsWith('.api_keys')) value = value.split(',').map((item) => item.trim()).filter(Boolean)
      if (field) {
        raw.providers ??= {}
        raw.providers[provider] ??= {}
        if (value === '') delete raw.providers[provider][field]
        else raw.providers[provider][field] = value
      } else if (value === '') {
        delete raw[keyPath]
      } else {
        raw[keyPath] = value
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
    process.stdout.write('fake config saved\n')
    process.exit(0)
  }
  if (sub === 'list') {
    if (booleans.has('json')) {
      const file = path.join(process.env.HOME, '.sgen', 'config.json')
      const raw = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
      const sensenova = raw.providers?.sensenova ?? {}
      const agnes = raw.providers?.agnes ?? {}
      const region = agnes.region === 'china' ? 'china' : 'international'
      print({
        ok: true,
        config_path: file,
        config_exists: fs.existsSync(file),
        providers: {
          sensenova: {
            keys: Array.isArray(sensenova.api_keys) ? sensenova.api_keys.length : 0,
            base_url: sensenova.base_url || 'https://catalog-sensenova.example.com/v1',
          },
          agnes: {
            keys: Array.isArray(agnes.api_keys) ? agnes.api_keys.length : 0,
            region,
            base_url: agnes.base_url || (region === 'china'
              ? 'https://catalog-agnes-china.example.com/v1'
              : 'https://catalog-agnes.example.com/v1'),
          },
        },
        env: { SENSENOVA_API_KEY: false, AGNES_API_KEY: false },
        default_models: {
          image: raw.default_image_model || 'catalog-image-default',
          video: raw.default_video_model || 'catalog-video-default',
        },
        update_check: raw.update_check !== false,
      })
    }
    process.stdout.write('商汤：1 把 Key（sk-****）  接口：https://token.sensenova.cn/v1\nAgnes：1 把 Key（ak-****）  区域：international  接口：https://apihub.agnes-ai.com/v1\n')
    process.exit(0)
  }
  if (sub === 'test') {
    print({
      ok: true,
      results: [
        {
          provider: 'sensenova',
          label: '商汤',
          status: 'ok',
          http_status: 200,
          key: 'sk-****',
          message: '连通（HTTP 200）',
        },
      ],
    })
  }
}

process.stderr.write(`fake-sgen: 未知命令 ${String(command)}\n`)
process.exit(2)
