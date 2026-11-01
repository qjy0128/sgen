/**
 * dsh-sgen — SGeN 生图/生视频的 DeepSeek Harness 宿主插件。
 *
 * 组成：
 *   - lib/tools.js    5 个原生工具（生图、生视频、查任务、模型目录、配置检查）
 *   - lib/skill.js    运行时技能 sgen（正文来自仓库 skill/sgen/SKILL.md）
 *   - lib/routes.js   只读作品面板数据与文件路由
 *   - lib/client.js   浏览器半边（侧栏 sgen 面板）
 *
 * 插件不 import 任何 @deepseek-ai/* 包，DSH 的 Loader 直接调用 apply()。
 * 所有生成、Key 轮换、价格校验、参数校验都由仓库里的 sgen CLI 完成。
 *
 * @module dsh-sgen
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeConfig } from './config.js'
import { createHistoryStore } from './history.js'
import { registerRoutes } from './routes.js'
import { registerSkill } from './skill.js'
import { registerTools } from './tools.js'

/** Loader 可见的插件名（行 id 是 `sgen`）。 */
export const name = 'sgen'

/** tools 是硬依赖；skills / webServer / attachments 都是可选项。 */
export const inject = ['tools']

/**
 * Loader 入口。
 * @param {any} ctx
 * @param {Record<string, unknown> | undefined} rawConfig
 */
export function apply(ctx, rawConfig) {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const config = normalizeConfig(rawConfig, { here })
  const history = createHistoryStore(config)
  const runtime = {
    config,
    history,
    modelsCache: { text: undefined, at: 0 },
  }

  registerTools(ctx, config, runtime)
  registerSkill(ctx, config)
  registerRoutes(ctx, config, history)

  ctx.logger?.info?.(`[sgen] 插件已加载：root=${config.sgenRoot} history=${config.historyFile}`)
}
