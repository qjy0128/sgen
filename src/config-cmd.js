import readline from 'node:readline'
import { configPath, readRawConfig, saveRawConfig, loadConfig, AGNES_CHINA_HINT } from './config.js'
import { PROVIDERS } from './catalog.js'
import { maskKey } from './keys.js'
import { usageErr } from './errors.js'
import { httpTimeoutMs } from './api.js'

function splitKeys(input) {
  return input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function askInteractive(rl, question) {
  return new Promise((resolve) => {
    let done = false
    const finish = (ans) => {
      if (!done) {
        done = true
        resolve((ans ?? '').trim())
      }
    }
    rl.on('close', () => finish(''))
    rl.question(question, finish)
  })
}

// 逐个提问：终端里交互作答；管道/重定向时一次性读完 stdin 按行取用
//（readline 的 question 在管道 EOF 时会抛 "readline was closed"，故分两条路径）
async function askAll(questions) {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    const answers = []
    for (const q of questions) answers.push(await askInteractive(rl, q))
    rl.close()
    return answers
  }
  const input = await new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', () => resolve(data))
  })
  const lines = input.split('\n')
  return questions.map((q, i) => {
    process.stdout.write(q)
    return (lines[i] ?? '').trim()
  })
}

async function configInit() {
  const [snInput, agnesInput, inChinaInput] = await askAll([
    '商汤 API Key（多把用英文逗号分隔，回车跳过）：',
    'Agnes API Key（多把用英文逗号分隔，回车跳过）：',
    '是否在中国境内？（只跟接入的 API 域名相关，功能完全一致）[Y/N，回车默认 N]：',
  ])
  // Y/yes/是 → 中国版域名；其余（含回车、N、无效输入）→ 国际版
  const region = ['y', 'yes', '是'].includes(inChinaInput.toLowerCase()) ? 'china' : 'international'

  const raw = readRawConfig()
  const providers = raw.providers ?? {}
  providers.sensenova = { ...(providers.sensenova ?? {}), api_keys: splitKeys(snInput) }
  providers.agnes = { ...(providers.agnes ?? {}), api_keys: splitKeys(agnesInput), region }
  saveRawConfig({ ...raw, providers })

  console.log(`已写入 ${configPath()}`)
  if (region === 'china') console.error(AGNES_CHINA_HINT)
  return 0
}

// 可设项注册表：解析函数 + 帮助文案（含义与示例），帮助文本由同一份数据渲染
const SETTABLE = {
  'sensenova.api_keys': {
    parse: (v) => splitKeys(v),
    desc: '商汤 Key 列表，多把用英文逗号分隔',
    example: 'sgen config set sensenova.api_keys sk-aaa,sk-bbb',
  },
  'agnes.api_keys': {
    parse: (v) => splitKeys(v),
    desc: 'Agnes Key 列表，多把用英文逗号分隔',
    example: 'sgen config set agnes.api_keys ak-aaa,ak-bbb',
  },
  'agnes.region': {
    parse: (v) => {
      if (v !== 'international' && v !== 'china') {
        throw usageErr('agnes.region 可选值：international（默认，国际版域名）/ china（中国版域名）')
      }
      return v
    },
    desc: '接入域名：international=国际版（默认）/ china=中国版\n                         只影响请求走哪个域名，功能完全一致，Key 目前通用',
    example: 'sgen config set agnes.region china',
  },
  'sensenova.base_url': {
    parse: (v) => v,
    desc: '进阶：覆写商汤接口地址',
    example: 'sgen config set sensenova.base_url https://token.sensenova.cn/v1',
  },
  'agnes.base_url': {
    parse: (v) => v,
    desc: '进阶：覆写 Agnes 接口地址',
    example: 'sgen config set agnes.base_url https://apihub.agnes-ai.com/v1',
  },
}

function renderSettable() {
  return Object.entries(SETTABLE)
    .map(([key, def]) => `    ${key.padEnd(20)} ${def.desc}\n                         例：${def.example}`)
    .join('\n')
}

async function configSet(keyPath, value) {
  if (!keyPath || value === undefined) {
    throw usageErr(`用法：sgen config set <路径> <值>\n${renderSettable()}`)
  }
  const item = SETTABLE[keyPath]
  if (!item) {
    throw usageErr(`不可设置的路径：${keyPath}\n${renderSettable()}`)
  }
  const parsed = item.parse(value)

  const raw = readRawConfig()
  const providers = raw.providers ?? {}
  const [providerId, field] = keyPath.split('.')
  providers[providerId] = { ...(providers[providerId] ?? {}), [field]: parsed }
  saveRawConfig({ ...raw, providers })

  console.log(`已设置 ${keyPath}`)
  if (keyPath === 'agnes.region' && parsed === 'china') console.error(AGNES_CHINA_HINT)
  return 0
}

function configList() {
  const cfg = loadConfig()
  const lines = [`配置文件：${configPath()}`]
  for (const pid of ['sensenova', 'agnes']) {
    const c = cfg[pid]
    const label = PROVIDERS[pid].label
    const masked = c.api_keys.map(maskKey)
    const keysPart = masked.length ? `${masked.length} 把 Key（${masked.join('、')}）` : '未配置 Key'
    const regionPart = pid === 'agnes' ? `  区域：${c.region}` : ''
    lines.push(`${label}：${keysPart}${regionPart}  接口：${c.base_url}`)
  }
  lines.push(
    `环境变量兜底：SENSENOVA_API_KEY ${process.env.SENSENOVA_API_KEY ? '已设置' : '未设置'}；AGNES_API_KEY ${process.env.AGNES_API_KEY ? '已设置' : '未设置'}`,
  )
  console.log(lines.join('\n'))
  return 0
}

// 连通性检查：逐把 Key 探测 <base_url>/models（只看通不通与鉴权，不产生生成费用）
async function configTest() {
  const cfg = loadConfig()
  for (const pid of ['sensenova', 'agnes']) {
    const c = cfg[pid]
    const label = PROVIDERS[pid].label
    if (!c.api_keys.length) {
      console.log(`${label}：未配置 Key，跳过`)
      continue
    }
    for (const key of c.api_keys) {
      let status
      try {
        const res = await fetch(`${c.base_url}/models`, {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(httpTimeoutMs()),
        })
        status = res.status
      } catch (err) {
        console.log(`${label} ${maskKey(key)}：✗ 无法连接（${String(err.message).split('\n')[0]}）`)
        continue
      }
      if (status === 401 || status === 403) {
        console.log(`${label} ${maskKey(key)}：✗ 鉴权失败（HTTP ${status}），Key 可能无效`)
      } else {
        console.log(`${label} ${maskKey(key)}：✓ 连通（HTTP ${status}）`)
      }
    }
  }
  return 0
}

export async function configCmd(argv) {
  const [sub, ...rest] = argv
  if (sub === 'init') return configInit()
  if (sub === 'set') return configSet(rest[0], rest[1])
  if (sub === 'list') return configList()
  if (sub === 'test') return configTest()
  throw usageErr(
    [
      '用法：sgen config <子命令>',
      '  init  交互式引导创建配置（推荐首次使用，会一步步问你要填什么）',
      '  set   设置单项：sgen config set <路径> <值>，可设置：',
      renderSettable(),
      '  list  查看当前配置（Key 打码显示）',
      '  test  逐把 Key 连通性检查（✓ 连通 / ✗ 鉴权失败）',
    ].join('\n'),
  )
}
