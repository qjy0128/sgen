import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { usageErr } from './errors.js'
import { PROVIDERS } from './catalog.js'

export const DEFAULT_BASE_URLS = {
  sensenova: 'https://token.sensenova.cn/v1',
  agnes: 'https://apihub.agnes-ai.com/v1',
}

// 各供应商 Key 对应的环境变量名（兜底单 Key；报错提示也用同一份）
export const PROVIDER_ENV_KEYS = {
  sensenova: 'SENSENOVA_API_KEY',
  agnes: 'AGNES_API_KEY',
}

// Agnes 双区提示：只在此处维护一份，由 config 命令展示（生成命令不再每次刷 stderr）
export const AGNES_CHINA_HINT =
  '提示：Agnes 中国版接口为 api.agnes-ai.cn（国际版为 apihub.agnes-ai.com）；两版 Key 目前通用，官方未承诺长期保持。'

// Agnes 双区：国际版与中国版接口域名不同（Key 目前通用，官方未承诺长期保持）
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

// 取某供应商配置；无 Key 时报错并指出对应环境变量名（image/video/status 共用）
export function resolveProviderConfig(providerId) {
  const cfg = loadConfig()[providerId]
  if (!cfg.api_keys.length) {
    throw usageErr(
      `未找到${PROVIDERS[providerId].label} API Key。请运行 sgen config init 配置，或设置环境变量 ${PROVIDER_ENV_KEYS[providerId]}。`,
    )
  }
  return cfg
}
