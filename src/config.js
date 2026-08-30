import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_BASE_URLS = {
  sensenova: 'https://token.sensenova.cn/v1',
  agnes: 'https://apihub.agnes-ai.com/v1',
}

// Agnes 双区：国际版与中国版域名不同，且两版 Key 不通用
export const AGNES_REGIONS = {
  international: 'https://apihub.agnes-ai.com/v1',
  china: 'https://api.agnes-ai.cn/v1',
}

export function configPath() {
  return path.join(os.homedir(), '.sgen', 'config.json')
}

export function readRawConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function saveRawConfig(config) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true })
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n')
}

// 配置来源：~/.sgen/config.json 优先，环境变量作为单 Key 兜底
export function loadConfig() {
  const providers = readRawConfig().providers ?? {}
  const envKey = process.env.SENSENOVA_API_KEY?.trim()
  const agnesEnvKey = process.env.AGNES_API_KEY?.trim()

  const sn = providers.sensenova ?? {}
  const keys = [...(sn.api_keys ?? [])]
  if (!keys.length && envKey) keys.push(envKey)

  const ag = providers.agnes ?? {}
  const agnesKeys = [...(ag.api_keys ?? [])]
  if (!agnesKeys.length && agnesEnvKey) agnesKeys.push(agnesEnvKey)
  const region = ag.region === 'china' ? 'china' : 'international'

  return {
    sensenova: {
      api_keys: keys.filter(Boolean),
      base_url: sn.base_url ?? DEFAULT_BASE_URLS.sensenova,
    },
    agnes: {
      api_keys: agnesKeys.filter(Boolean),
      base_url: ag.base_url ?? AGNES_REGIONS[region],
      region,
    },
  }
}
