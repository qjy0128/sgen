/**
 * dsh-sgen 配置解析与 CLI 定位。
 *
 * 设计约束：
 *   - 插件默认从自身位置向上找到 SGeN 仓库，不依赖 PATH 里的 sgen；
 *   - 宿主是 Electron 时用同一可执行文件加 ELECTRON_RUN_AS_NODE=1 跑 Node，
 *     避免 GUI 进程的 PATH 里没有 node；
 *   - 任何路径都只做展开、校验和可解释的错误，不静默猜错。
 *
 * @module dsh-sgen/config
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULTS = {
  sgenRoot: '',
  sgenBin: '',
  nodePath: '',
  historyFile: '',
  playgroundDir: '',
  maxHistory: 100,
  updateCheck: false,
  defaultCwd: '',
  commandTimeoutMs: 1800000,
  env: {},
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** 展开 ~ 和 ~/xxx；其余原样返回。 */
export function expandHome(value) {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2))
  }
  return value
}

export function pluginSettingsPath() {
  return path.join(os.homedir(), '.sgen', 'dsh-plugin.json')
}

export function readPluginSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(pluginSettingsPath(), 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** 把未知配置值收敛为字符串；空串表示“用默认值”。 */
function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 正整数，超出范围时回落到默认值。 */
function positiveInteger(value, fallback) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : fallback
}

/** 布尔值：只有显式 true/false 生效，其余用默认值。 */
function boolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/** 判断目录是否像一个 SGeN 仓库根目录。 */
export function isSgenRoot(dir) {
  if (!dir) return false
  try {
    return (
      fs.existsSync(path.join(dir, 'bin', 'sgen.js')) &&
      fs.existsSync(path.join(dir, 'package.json'))
    )
  } catch {
    return false
  }
}

/**
 * 从 PATH 里找 sgen，并反推出仓库根目录。
 * 支持 npm link 的软链：~/.local/bin/sgen -> ~/Coding/sgen/bin/sgen.js。
 */
function rootFromPath() {
  const dirs = String(process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    const candidate = path.join(dir, 'sgen')
    try {
      const real = fs.realpathSync(candidate)
      const root = path.dirname(path.dirname(real))
      if (isSgenRoot(root)) return root
    } catch {
      // 这一项不是可用的 sgen
    }
  }
  return ''
}

/**
 * 解析 SGeN 仓库根目录。
 * 优先级：显式配置 > SGEN_ROOT 环境变量 > 插件所在仓库 > 同目录安装的 sgen 依赖 > PATH 里的 sgen > ~/Coding/sgen。
 */
export function resolveSgenRoot(rawValue, packageRoot) {
  const explicit = text(rawValue)
  if (explicit) return path.resolve(expandHome(explicit))

  const fromEnv = text(process.env.SGEN_ROOT)
  if (fromEnv) return path.resolve(expandHome(fromEnv))

  const fromPackage = path.resolve(packageRoot, '..')
  if (isSgenRoot(fromPackage)) return fromPackage

  const fromDependency = path.resolve(packageRoot, '..', 'sgen')
  if (isSgenRoot(fromDependency)) return fromDependency

  const fromPath = rootFromPath()
  if (fromPath) return fromPath

  const fromHome = path.join(os.homedir(), 'Coding', 'sgen')
  if (isSgenRoot(fromHome)) return fromHome

  // 都不存在时仍返回预期位置，执行时给出可操作的错误信息。
  return fromPackage
}

/** 宿主提供的 Node 可执行文件；Electron 下与宿主同一个二进制。 */
export function defaultNodePath() {
  return process.env.DSH_DESKTOP_NODE_EXECUTABLE?.trim() || process.execPath
}

/** 宿主是否运行在 Electron 里（这时要给子进程加 ELECTRON_RUN_AS_NODE=1）。 */
export function hostIsElectron() {
  return Boolean(process.versions?.electron)
}

/**
 * 把 bundle 行里的原始配置收敛成稳定、绝对路径化的配置。
 * @param {Record<string, unknown> | undefined} raw
 * @param {{ here: string }} options  lib/ 目录的绝对路径
 */
export function normalizeConfig(raw, { here }) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const packageRoot = path.resolve(here, '..')
  const sgenRoot = resolveSgenRoot(input.sgenRoot, packageRoot)
  const sgenBin = text(input.sgenBin)
  const nodePath = text(input.nodePath) || defaultNodePath()
  const historyFile = text(input.historyFile)
    ? path.resolve(expandHome(text(input.historyFile)))
    : path.join(os.homedir(), '.sgen', 'dsh-gallery.json')
  const configuredPlaygroundDir = text(input.playgroundDir) || text(readPluginSettings().playground_dir)
  const playgroundDir = configuredPlaygroundDir
    ? path.resolve(expandHome(configuredPlaygroundDir))
    : path.join(os.homedir(), 'sgen')
  const defaultCwd = text(input.defaultCwd)
    ? path.resolve(expandHome(text(input.defaultCwd)))
    : ''
  const env = {}
  if (input.env && typeof input.env === 'object' && !Array.isArray(input.env)) {
    for (const [key, value] of Object.entries(input.env)) {
      if (typeof key === 'string' && key && value !== undefined && value !== null) {
        env[key] = String(value)
      }
    }
  }
  const updateCheck = boolean(input.updateCheck, DEFAULTS.updateCheck)
  if (!updateCheck) env.SGEN_NO_UPDATE_CHECK = env.SGEN_NO_UPDATE_CHECK ?? '1'

  return {
    sgenRoot,
    sgenBin,
    nodePath,
    historyFile,
    playgroundDir,
    maxHistory: Math.min(1000, positiveInteger(input.maxHistory, DEFAULTS.maxHistory)),
    updateCheck,
    defaultCwd,
    commandTimeoutMs: Math.min(
      7_200_000,
      positiveInteger(input.commandTimeoutMs, DEFAULTS.commandTimeoutMs),
    ),
    env,
    packageRoot,
  }
}

function looksLikeScript(file) {
  return /\.(?:c|m)?js$/i.test(file)
}

function isExecutable(file) {
  try {
    return (fs.statSync(file).mode & 0o111) !== 0
  } catch {
    return false
  }
}

/**
 * 解析真正要执行的命令。
 *
 * 默认永远用 Node 跑 bin/sgen.js，而不是依赖 PATH 和 shebang：
 * DSH Desktop 的宿主 PATH 可能与终端不同。
 *
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {{ command: string, prefix: string[], display: string, useElectronNode: boolean }}
 */
export function resolveCommand(config) {
  const cliEntry = path.join(config.sgenRoot, 'bin', 'sgen.js')
  if (!config.sgenBin) {
    if (!fs.existsSync(cliEntry)) {
      throw new Error(
        `找不到 SGeN CLI：${cliEntry}\n` +
          `请确认 SGeN 仓库仍在 ${config.sgenRoot}，或在 DSH 插件配置里设置 sgenRoot / sgenBin。`,
      )
    }
    return {
      command: config.nodePath,
      prefix: [cliEntry],
      display: `node ${cliEntry}`,
      useElectronNode: hostIsElectron() && config.nodePath === process.execPath,
    }
  }

  const raw = expandHome(config.sgenBin)
  const isPath = raw.includes('/') || raw.includes('\\') || raw.startsWith('.')
  const resolved = isPath ? path.resolve(config.sgenRoot, raw) : raw

  // 裸命令（如 sgen）交给 execvp；路径形式的 JS 一律用 Node 跑。
  if (isPath && looksLikeScript(resolved)) {
    if (!fs.existsSync(resolved)) {
      throw new Error(`找不到 sgenBin 指向的文件：${resolved}`)
    }
    return {
      command: config.nodePath,
      prefix: [resolved],
      display: `node ${resolved}`,
      useElectronNode: hostIsElectron() && config.nodePath === process.execPath,
    }
  }
  if (isPath && fs.existsSync(resolved) && isExecutable(resolved)) {
    return { command: resolved, prefix: [], display: resolved, useElectronNode: false }
  }
  if (isPath && fs.existsSync(resolved)) {
    return {
      command: config.nodePath,
      prefix: [resolved],
      display: `node ${resolved}`,
      useElectronNode: hostIsElectron() && config.nodePath === process.execPath,
    }
  }
  if (isPath) throw new Error(`找不到 sgenBin 指向的文件：${resolved}`)

  return { command: raw, prefix: [], display: raw, useElectronNode: false }
}

/** 面板与路由用：判断请求的 Host 是否只指向本机。 */
export function isLoopbackHost(host) {
  if (!host) return false
  let hostname = String(host).trim().toLowerCase()
  if (hostname.startsWith('[')) {
    const end = hostname.indexOf(']')
    hostname = end >= 0 ? hostname.slice(0, end + 1) : hostname
  } else {
    hostname = hostname.split(':')[0]
  }
  return LOOPBACK_HOSTS.has(hostname)
}
