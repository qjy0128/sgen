import readline from 'node:readline'
import { configPath, readRawConfig, saveRawConfig, loadConfig } from './config.js'
import { PROVIDERS } from './catalog.js'
import { maskKey } from './keys.js'
import { usageErr } from './errors.js'

const CHINA_REMINDER = '提示：Agnes 中国版（api.agnes-ai.cn）与国际版 Key 不通用，请确认 Key 归属。'

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
  const [snInput, agnesInput, regionInput] = await askAll([
    '商汤 API Key（多把用英文逗号分隔，回车跳过）：',
    'Agnes API Key（多把用英文逗号分隔，回车跳过）：',
    'Agnes 区域 international/china（回车默认 international）：',
  ])
  const region = regionInput === 'china' ? 'china' : 'international'

  const raw = readRawConfig()
  const providers = raw.providers ?? {}
  providers.sensenova = { ...(providers.sensenova ?? {}), api_keys: splitKeys(snInput) }
  providers.agnes = { ...(providers.agnes ?? {}), api_keys: splitKeys(agnesInput), region }
  saveRawConfig({ ...raw, providers })

  console.log(`已写入 ${configPath()}`)
  if (region === 'china') console.error(CHINA_REMINDER)
  return 0
}

const SETTABLE = {
  'sensenova.api_keys': (v) => splitKeys(v),
  'agnes.api_keys': (v) => splitKeys(v),
  'sensenova.base_url': (v) => v,
  'agnes.base_url': (v) => v,
  'agnes.region': (v) => {
    if (v !== 'international' && v !== 'china') {
      throw usageErr('agnes.region 可选值：international、china')
    }
    return v
  },
}

async function configSet(keyPath, value) {
  if (!keyPath || value === undefined) {
    throw usageErr(`用法：sgen config set <路径> <值>\n可设置：${Object.keys(SETTABLE).join('、')}`)
  }
  const parse = SETTABLE[keyPath]
  if (!parse) {
    throw usageErr(`不可设置的路径：${keyPath}\n可设置：${Object.keys(SETTABLE).join('、')}`)
  }
  const parsed = parse(value)

  const raw = readRawConfig()
  const providers = raw.providers ?? {}
  const [providerId, field] = keyPath.split('.')
  providers[providerId] = { ...(providers[providerId] ?? {}), [field]: parsed }
  saveRawConfig({ ...raw, providers })

  console.log(`已设置 ${keyPath}`)
  if (keyPath === 'agnes.region' && parsed === 'china') console.error(CHINA_REMINDER)
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
    `用法：sgen config <init|set|list|test>\n  init  交互式引导创建配置\n  set   设置单项（如 agnes.region china）\n  list  查看配置（Key 打码）\n  test  逐把 Key 连通性检查`,
  )
}
