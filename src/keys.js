import { readProviderCursor, writeProviderCursor } from './state.js'
import { createHash } from 'node:crypto'

// 触发换 Key 的状态码：鉴权失败（Key 坏了）与限流（额度撞了）
const ROTATE_ON_STATUS = [401, 403, 429]

export function maskKey(key) {
  if (key.length <= 8) return `${key.slice(0, 2)}***`
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

export function fingerprintKey(key) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

// Key 池：按持久化游标轮转起步（跨调用分摊额度）；
// 401/403/429 自动换下一把重试一轮，全部失败才抛错并逐把汇总；网络错误不换 Key。
// 游标策略：发生轮换后，下次调用从本次成功的好 Key 起步（跳过已知坏 Key，不再每次浪费一次请求）
export async function callWithKeyPool({ providerId, label, keys, preferredKey, fn }) {
  const preferredIndex = preferredKey ? keys.indexOf(preferredKey) : -1
  const cursor = preferredIndex >= 0 ? preferredIndex : readProviderCursor(providerId) % keys.length
  const order = [...keys.slice(cursor), ...keys.slice(0, cursor)]
  const failures = []

  for (const key of order) {
    try {
      const result = await fn(key)
      writeProviderCursor(providerId, failures.length ? keys.indexOf(key) : (keys.indexOf(key) + 1) % keys.length)
      return result
    } catch (err) {
      if (err.kind === 'api' && ROTATE_ON_STATUS.includes(err.status) && err.rotatable !== false) {
        failures.push(`  · ${maskKey(key)}：${err.message.split('\n')[0]}`)
        writeProviderCursor(providerId, (keys.indexOf(key) + 1) % keys.length)
        continue
      }
      throw err
    }
  }

  const lines = [
    `${label}全部 ${keys.length} 把 Key 均失败：`,
    ...failures,
    '请运行 sgen config init 检查配置；Agnes 两版接口域名不同（Key 目前通用），持续失败可检查区域设置。',
  ]
  throw Object.assign(new Error(lines.join('\n')), { kind: 'api' })
}
