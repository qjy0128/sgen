/**
 * dsh-sgen 的 CLI 调用层。
 *
 * 只负责“启动一个子进程、收集有上限的输出、把 --json 结果解析出来”，
 * 不解释 sgen 的业务语义；业务错误由 CLI 的 JSON 和退出码表达。
 *
 * @module dsh-sgen/run
 */

import { spawn } from 'node:child_process'
import { resolveCommand } from './config.js'

const MAX_OUTPUT_CHARS = 2_000_000
const KILL_GRACE_MS = 2000

/** CLI 失败时抛出的错误，保留结构化上下文供工具层整理。 */
export class SgenCommandError extends Error {
  constructor(message, { code, stdout = '', stderr = '', timedOut = false, aborted = false } = {}) {
    super(message)
    this.name = 'SgenCommandError'
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
    this.timedOut = timedOut
    this.aborted = aborted
  }
}

function abortError() {
  const error = new Error('sgen 调用已取消')
  error.name = 'AbortError'
  return error
}

function appendChunk(current, chunk) {
  if (current.length >= MAX_OUTPUT_CHARS) return current
  const next = current + chunk
  return next.length > MAX_OUTPUT_CHARS ? `${next.slice(0, MAX_OUTPUT_CHARS)}\n…（输出过长已截断）` : next
}

/**
 * 从任意文本里取最后一个可解析的 JSON 对象。
 * CLI 的 --json 是单行，但这里也容忍前面有进度行或格式化输出。
 */
export function parseJsonOutput(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return undefined
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first < 0 || last <= first) return undefined
  const candidate = raw.slice(first, last + 1)
  try {
    return JSON.parse(candidate)
  } catch {
    // 再按行从后往前试一次：提示行里可能也有花括号
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().startsWith('{'))
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i])
      } catch {
        // 继续找上一行
      }
    }
    return undefined
  }
}

function errorMessageFrom(stdout, stderr, code) {
  const parsed = parseJsonOutput(stdout)
  const remote = parsed && typeof parsed === 'object' ? parsed.error?.message : undefined
  const stderrText = String(stderr ?? '').trim()
  const stdoutText = String(stdout ?? '').trim()
  const parts = []
  if (typeof remote === 'string' && remote.trim()) parts.push(remote.trim())
  else if (stderrText) parts.push(stderrText)
  if (stderrText && !parts.includes(stderrText)) parts.push(stderrText)
  if (!parts.length && stdoutText) parts.push(stdoutText)
  if (!parts.length) parts.push(`sgen 退出码 ${code}`)
  return parts.join('\n')
}

/**
 * 运行 sgen CLI。
 *
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 * @param {string[]} args
 * @param {{ cwd?: string, signal?: AbortSignal, timeoutMs?: number, allowNonZero?: boolean }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runSgen(config, args, { cwd, signal, timeoutMs, allowNonZero = false } = {}) {
  const command = resolveCommand(config)
  const env = { ...process.env, ...config.env }
  if (command.useElectronNode || (process.versions?.electron && command.command === config.nodePath)) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  const budget = Math.max(1, Number(timeoutMs) || config.commandTimeoutMs)

  return new Promise((resolve, reject) => {
    let child
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let aborted = false
    let settled = false
    let timer
    let killTimer

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
    }

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }

    const killChild = () => {
      if (!child || child.killed) return
      try {
        child.kill('SIGTERM')
      } catch {
        return
      }
      killTimer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // 进程已经退出
        }
      }, KILL_GRACE_MS)
      killTimer.unref?.()
    }

    const onAbort = () => {
      aborted = true
      killChild()
    }

    if (signal?.aborted) {
      reject(abortError())
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      child = spawn(command.command, [...command.prefix, ...args], {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch (error) {
      cleanup()
      reject(
        new SgenCommandError(
          `无法启动 SGeN（${command.display}）：${error.message}\n请检查插件配置里的 sgenRoot / sgenBin / nodePath。`,
        ),
      )
      return
    }

    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout = appendChunk(stdout, chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = appendChunk(stderr, chunk)
    })

    child.once('error', (error) => {
      if (aborted) {
        finish(reject, abortError())
        return
      }
      finish(
        reject,
        new SgenCommandError(
          `无法启动 SGeN（${command.display}）：${error.message}\n请检查插件配置里的 sgenRoot / sgenBin / nodePath。`,
          { code: null, stdout, stderr },
        ),
      )
    })

    child.once('close', (code, killSignal) => {
      if (aborted) {
        finish(reject, abortError())
        return
      }
      if (timedOut) {
        finish(
          reject,
          new SgenCommandError(`sgen 执行超过 ${Math.round(budget / 1000)} 秒，已终止。`, {
            code,
            stdout,
            stderr,
            timedOut: true,
          }),
        )
        return
      }
      if (code !== 0 && !allowNonZero) {
        finish(
          reject,
          new SgenCommandError(errorMessageFrom(stdout, stderr, code ?? killSignal), {
            code,
            stdout,
            stderr,
          }),
        )
        return
      }
      finish(resolve, { code: code ?? -1, stdout, stderr })
    })

    timer = setTimeout(() => {
      timedOut = true
      killChild()
    }, budget)
    timer.unref?.()
  })
}

/**
 * 运行带 --json 的 sgen 命令，并要求 stdout 里有可解析的 JSON。
 * @returns {Promise<{ data: any, stdout: string, stderr: string, code: number }>}
 */
export async function runSgenJson(config, args, options = {}) {
  const result = await runSgen(config, args, options)
  const data = parseJsonOutput(result.stdout)
  if (data === undefined) {
    throw new SgenCommandError(
      `sgen 没有返回可解析的 JSON：${result.stdout.trim() || result.stderr.trim() || '（空输出）'}`,
      result,
    )
  }
  return { data, ...result }
}
