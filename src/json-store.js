import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const LOCK_RETRIES = 200
const LOCK_WAIT_MS = 10
const STALE_LOCK_MS = 30_000
const waitArray = new Int32Array(new SharedArrayBuffer(4))

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  fs.chmodSync(dir, 0o700)
}

function acquireLock(filePath) {
  const lockPath = `${filePath}.lock`
  for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600)
      return { fd, lockPath }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          fs.unlinkSync(lockPath)
          continue
        }
      } catch {
        continue
      }
      Atomics.wait(waitArray, 0, 0, LOCK_WAIT_MS)
    }
  }
  throw new Error(`等待文件锁超时：${lockPath}`)
}

function releaseLock(lock) {
  try {
    fs.closeSync(lock.fd)
  } finally {
    try {
      fs.unlinkSync(lock.lockPath)
    } catch {
      // 锁文件已不存在时无需处理
    }
  }
}

export function readJsonFile(filePath, fallback = {}) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    try {
      ensurePrivateDir(path.dirname(filePath))
      fs.chmodSync(filePath, 0o600)
    } catch {
      // 只读环境下仍允许读取
    }
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeUnlocked(filePath, value) {
  const dir = path.dirname(filePath)
  ensurePrivateDir(dir)
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    fs.renameSync(tempPath, filePath)
    fs.chmodSync(filePath, 0o600)
  } finally {
    try {
      fs.unlinkSync(tempPath)
    } catch {
      // 已成功改名或临时文件从未创建
    }
  }
}

export function writeJsonFile(filePath, value) {
  ensurePrivateDir(path.dirname(filePath))
  const lock = acquireLock(filePath)
  try {
    writeUnlocked(filePath, value)
  } finally {
    releaseLock(lock)
  }
}

export function updateJsonFile(filePath, updater) {
  ensurePrivateDir(path.dirname(filePath))
  const lock = acquireLock(filePath)
  try {
    const next = updater(readJsonFile(filePath, {}))
    writeUnlocked(filePath, next)
    return next
  } finally {
    releaseLock(lock)
  }
}
