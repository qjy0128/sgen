import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readRawConfig } from './config.js'

// 默认检查 main 分支的 package.json（公开仓库无需认证）；测试用 SGEN_UPDATE_CHECK_URL 覆写
export const DEFAULT_CHECK_URL = 'https://raw.githubusercontent.com/qjy0128/sgen/main/package.json'

// 检查与提示的共同频率：一天一次
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

export function localVersion() {
  return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
}

export function statePath() {
  return path.join(os.homedir(), '.sgen', 'state.json')
}

export function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), 'utf8'))
  } catch {
    return {}
  }
}

export function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(statePath()), { recursive: true })
    fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n')
  } catch {
    // 状态写失败不影响命令本身
  }
}

// x.y.z 数字段逐段比较：a > b 返回正数，相等返回 0（零依赖，不引 semver 包）
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d
  }
  return 0
}

// 三通道禁用：环境变量 SGEN_NO_UPDATE_CHECK、CI 环境、配置 update_check: false
export function updateCheckDisabled() {
  if (process.env.SGEN_NO_UPDATE_CHECK || process.env.CI) return true
  return readRawConfig().update_check === false
}

// 主进程启动时调用：fire-and-forget 后台检查，detached + unref，不拖住退出
export function startUpdateCheck() {
  if (updateCheckDisabled()) return
  try {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('./update-check.js', import.meta.url))],
      { detached: true, stdio: 'ignore', env: process.env },
    )
    child.unref()
  } catch {
    // spawn 失败（受限环境）静默忽略
  }
}

// 命令结束时调用：远端版本更高则往 stderr 打一行提示；检查结果通常下次命令才生效。
// 同一版本一天最多提示一次（notified 记录）；出现更高版本时重新提示。
export function notifyUpdate() {
  if (updateCheckDisabled()) return
  try {
    const state = readState()
    const { remoteVersion } = state
    if (!remoteVersion) return
    const local = localVersion()
    if (compareVersions(remoteVersion, local) <= 0) return
    const n = state.notified
    if (n && n.version === remoteVersion && Date.now() - n.at < CHECK_INTERVAL_MS) return
    console.error(`sgen 有新版本 v${remoteVersion}（当前 v${local}），到仓库目录运行 git pull 更新。`)
    writeState({ ...state, notified: { version: remoteVersion, at: Date.now() } })
  } catch {
    // 提示失败不影响命令结果
  }
}
