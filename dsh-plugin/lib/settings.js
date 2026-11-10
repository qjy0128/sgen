import fsp from 'node:fs/promises'
import path from 'node:path'
import { expandHome, pluginSettingsPath, readPluginSettings } from './config.js'
import { runSgen } from './run.js'

const PROVIDERS = new Set(['sensenova', 'agnes'])

function invalid(message) {
  return Object.assign(new Error(message), { statusCode: 400 })
}

function textField(input, name, maxLength) {
  const value = input[name]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw invalid(`${name} 必须是字符串`)
  if (value.length > maxLength) throw invalid(`${name} 过长`)
  return value.trim()
}

export async function savePanelSettings(config, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw invalid('配置内容必须是 JSON 对象')
  }
  const updates = []
  if (input.api_keys !== undefined) {
    const keys = input.api_keys
    if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
      throw invalid('api_keys 必须是按服务商分组的对象')
    }
    for (const provider of PROVIDERS) {
      const apiKey = textField(keys, provider, 16_384)
      if (apiKey) updates.push(`${provider}.api_keys`, apiKey)
    }
  } else {
    const provider = textField(input, 'provider', 40)
    const apiKey = textField(input, 'api_key', 16_384)
    const baseUrl = textField(input, 'base_url', 2048)
    if ((apiKey || baseUrl !== undefined) && !PROVIDERS.has(provider)) {
      throw invalid('provider 只能是 sensenova 或 agnes')
    }
    if (apiKey) updates.push(`${provider}.api_keys`, apiKey)
    if (baseUrl !== undefined) updates.push(`${provider}.base_url`, baseUrl)
  }

  const imageModel = textField(input, 'default_image_model', 200)
  const videoModel = textField(input, 'default_video_model', 200)
  if (imageModel !== undefined) updates.push('default_image_model', imageModel)
  if (videoModel !== undefined) updates.push('default_video_model', videoModel)
  if (!updates.length) throw invalid('没有需要保存的配置')

  await runSgen(config, ['config', 'set', ...updates], {
    cwd: config.sgenRoot,
    timeoutMs: Math.min(config.commandTimeoutMs, 60_000),
  })
}

export async function savePlaygroundDir(config, value) {
  if (typeof value !== 'string' || !value.trim()) throw invalid('产物目录不能为空')
  if (value.length > 4096) throw invalid('产物目录过长')
  const directory = path.resolve(expandHome(value.trim()))
  const file = pluginSettingsPath()
  const dir = path.dirname(file)
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await fsp.writeFile(temp, `${JSON.stringify({ ...readPluginSettings(), playground_dir: directory }, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    await fsp.rename(temp, file)
    await fsp.chmod(file, 0o600).catch(() => {})
  } finally {
    await fsp.unlink(temp).catch(() => {})
  }
  config.playgroundDir = directory
}
