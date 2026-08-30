import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// 触发换 Key 的状态码：鉴权失败（Key 坏了）与限流（额度撞了）
const ROTATE_ON_STATUS = [401, 403, 429]

function statePath() {
  return path.join(os.homedir(), '.sgen', 'state.json')
}

function readCursor(providerId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'))[providerId]?.cursor ?? 0
  } catch {
    return 0
  }
}

function writeCursor(providerId, cursor) {
  let state = {}
  try {
    state = JSON.parse(fs.readFileSync(statePath(), 'utf8'))
  } catch {
    // 无状态文件时新建
  }
  state[providerId] = { cursor }
  fs.mkdirSync(path.dirname(statePath()), { recursive: true })
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2))
}

export function maskKey(key) {
  if (key.length <= 8) return `${key.slice(0, 2)}***`
  return `${key.slice(0, 3)}***${key.slice(-4)}`
}

// Key 池：按持久化游标轮转起步（跨调用分摊额度）；
// 401/403/429 自动换下一把重试一轮，全部失败才抛错并逐把汇总；网络错误不换 Key
export async function callWithKeyPool({ providerId, label, keys, fn }) {
  const cursor = readCursor(providerId) % keys.length
  const order = [...keys.slice(cursor), ...keys.slice(0, cursor)]
  const failures = []

  for (const key of order) {
    try {
      const result = await fn(key)
      writeCursor(providerId, (keys.indexOf(key) + 1) % keys.length)
      return result
    } catch (err) {
      if (err.kind === 'api' && ROTATE_ON_STATUS.includes(err.status) && err.rotatable !== false) {
        failures.push(`  · ${maskKey(key)}：${err.message.split('\n')[0]}`)
        continue
      }
      throw err
    }
  }

  const lines = [
    `${label}全部 ${keys.length} 把 Key 均失败：`,
    ...failures,
    '请运行 sgen config init 检查配置；Agnes 国际版与中国版 Key 不通用，请确认 Key 归属平台。',
  ]
  throw Object.assign(new Error(lines.join('\n')), { kind: 'api' })
}
