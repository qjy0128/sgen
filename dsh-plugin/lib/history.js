/**
 * 插件自己的作品索引：只记录“文件在哪、用什么模型生成的”，不复制文件，
 * 也不把任何 Key 写进去。它只是面板的派生缓存；真正的文件以磁盘为准。
 *
 * @module dsh-sgen/history
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

const HISTORY_VERSION = 1
const PROMPT_MAX = 500

function fileId(file) {
  return createHash('sha1').update(path.resolve(String(file))).digest('hex').slice(0, 16)
}

function safeString(value, max = 200) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const file = safeString(raw.file, 4096)
  if (!file) return undefined
  const id = safeString(raw.id, 64) || fileId(file)
  const kind = raw.kind === 'video' ? 'video' : 'image'
  return {
    id,
    kind,
    file: path.resolve(file),
    name: safeString(raw.name, 255) || path.basename(file),
    model: safeString(raw.model, 200) || '未知模型',
    prompt: safeString(raw.prompt, PROMPT_MAX),
    created_at: safeString(raw.created_at, 40) || new Date().toISOString(),
    ...(typeof raw.width === 'number' ? { width: raw.width } : {}),
    ...(typeof raw.height === 'number' ? { height: raw.height } : {}),
    ...(raw.size ? { size: safeString(raw.size, 40) } : {}),
    ...(raw.ratio ? { ratio: safeString(raw.ratio, 40) } : {}),
    ...(Number.isFinite(raw.elapsed_ms) ? { elapsed_ms: Math.round(raw.elapsed_ms) } : {}),
    ...(raw.video_id ? { video_id: safeString(raw.video_id, 200) } : {}),
  }
}

/**
 * 创建作品索引。所有写操作在同一个 Promise 队列里串行，避免多个会话同时生成时
 * 读到旧数组再互相覆盖。
 *
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
export function createHistoryStore(config) {
  let queue = Promise.resolve()

  const filePath = config.historyFile

  async function read() {
    try {
      const raw = await fsp.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw)
      const items = Array.isArray(parsed?.items) ? parsed.items : []
      return items.map(normalizeItem).filter(Boolean)
    } catch {
      return []
    }
  }

  async function write(items) {
    const dir = path.dirname(filePath)
    await fsp.mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      await fsp.chmod(dir, 0o700)
    } catch {
      // 只读/非 POSIX 环境下忽略
    }
    const temp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
    try {
      await fsp.writeFile(temp, `${JSON.stringify({ version: HISTORY_VERSION, items }, null, 2)}\n`, {
        mode: 0o600,
        flag: 'wx',
      })
      await fsp.rename(temp, filePath)
      try {
        await fsp.chmod(filePath, 0o600)
      } catch {
        // 同上
      }
    } finally {
      await fsp.unlink(temp).catch(() => {})
    }
  }

  function enqueue(task) {
    const run = queue.then(task, task)
    queue = run.catch(() => {})
    return run
  }

  return {
    filePath,

    async list(limit = config.maxHistory) {
      const items = await read()
      return items
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, Math.max(1, Math.min(config.maxHistory, Number(limit) || config.maxHistory)))
    },

    async get(id) {
      if (!id) return undefined
      const items = await read()
      return items.find((item) => item.id === id)
    },

    /**
     * 新增或更新一条记录。同一条文件路径会去重并移到最前。
     * 失败时抛错，由调用方决定是否影响生成结果（默认不影响）。
     */
    async add(raw) {
      if (!raw || typeof raw.file !== 'string' || !raw.file.trim()) {
        throw new Error('作品记录缺少有效文件路径')
      }
      const item = normalizeItem({ ...raw, id: raw.id || fileId(raw.file) })
      if (!item) throw new Error('作品记录缺少有效文件路径')
      return enqueue(async () => {
        const items = await read()
        const next = [item, ...items.filter((entry) => entry.id !== item.id && entry.file !== item.file)]
        await write(next.slice(0, config.maxHistory))
        return item
      })
    },
  }
}

/** 读取 SGeN 配置的“安全摘要”：只给数量、区域和接口域名，绝不返回 Key 原文。 */
export async function readSgenConfigSummary(config) {
  const configPath = path.join(os.homedir(), '.sgen', 'config.json')
  const summary = {
    config_path: configPath,
    config_exists: false,
    providers: {
      sensenova: { keys: 0 },
      agnes: { keys: 0, region: 'international' },
    },
    env: {
      SENSENOVA_API_KEY: Boolean(process.env.SENSENOVA_API_KEY?.trim()),
      AGNES_API_KEY: Boolean(process.env.AGNES_API_KEY?.trim()),
    },
  }
  let raw
  try {
    raw = JSON.parse(await fsp.readFile(configPath, 'utf8'))
    summary.config_exists = true
  } catch {
    return summary
  }
  const providers = raw && typeof raw === 'object' ? raw.providers : undefined
  for (const id of ['sensenova', 'agnes']) {
    const entry = providers && typeof providers === 'object' ? providers[id] : undefined
    const keys = Array.isArray(entry?.api_keys) ? entry.api_keys.filter(Boolean) : []
    summary.providers[id] = {
      keys: keys.length,
      ...(id === 'agnes' ? { region: entry?.region === 'china' ? 'china' : 'international' } : {}),
      ...(typeof entry?.base_url === 'string' && entry.base_url.trim()
        ? { base_url: entry.base_url.trim() }
        : {}),
    }
  }
  summary.update_check = raw?.update_check !== false
  return summary
}

/** 读取 SGeN 本地版本号，用于面板展示。读不到时返回 undefined。 */
export async function readSgenVersion(config) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(config.sgenRoot, 'package.json'), 'utf8'))
    return typeof raw?.version === 'string' ? raw.version : undefined
  } catch {
    return undefined
  }
}

/** 汇总面板需要的全部只读数据。 */
export async function readPanelState(config, history) {
  const [summary, version, items] = await Promise.all([
    readSgenConfigSummary(config),
    readSgenVersion(config),
    history.list(config.maxHistory),
  ])
  return {
    version: version ?? null,
    root: config.sgenRoot,
    history_file: config.historyFile,
    max_history: config.maxHistory,
    ...summary,
    items,
  }
}

/** 测试与排错用：返回索引文件是否存在（不读内容）。 */
export function historyExists(config) {
  try {
    return fs.existsSync(config.historyFile)
  } catch {
    return false
  }
}
