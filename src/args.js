import { usageErr } from './errors.js'

export function parseArgs(argv, { flags = [], booleans = [], multi = [] } = {}) {
  const out = { positionals: [], values: {} }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') {
      out.positionals.push(...argv.slice(i + 1))
      break
    }
    if (a.startsWith('--')) {
      let key = a.slice(2)
      let val
      const eq = key.indexOf('=')
      if (eq >= 0) {
        val = key.slice(eq + 1)
        key = key.slice(0, eq)
      }
      if (booleans.includes(key)) {
        if (val !== undefined) throw usageErr(`--${key} 是开关参数，不接受值`)
        out.values[key] = true
        continue
      }
      const known = flags.includes(key) || multi.includes(key)
      if (!known) throw usageErr(`未知参数 --${key}（运行 sgen --help 查看用法）`)
      if (val === undefined) {
        val = argv[++i]
        if (val === undefined || val.startsWith('--')) throw usageErr(`--${key} 缺少值`)
      }
      if (multi.includes(key)) {
        ;(out.values[key] ??= []).push(val)
      } else {
        out.values[key] = val
      }
    } else {
      out.positionals.push(a)
    }
  }
  return out
}
