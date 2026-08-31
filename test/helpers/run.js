import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const BIN = path.join(ROOT, 'bin/sgen.js')

// 以子进程黑盒方式运行 sgen；env 默认全新（不继承外部环境变量，保证测试确定性）
// updateCheck 默认关闭（注入 SGEN_NO_UPDATE_CHECK=1），仅更新检查自身的测试显式开启
export function run(args, { env = {}, cwd, stdin, updateCheck = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: {
        PATH: process.env.PATH,
        ...(updateCheck ? {} : { SGEN_NO_UPDATE_CHECK: '1' }),
        ...env,
      },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    if (stdin !== undefined) child.stdin.end(stdin)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
