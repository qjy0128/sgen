/**
 * 把仓库里的 skill/sgen/SKILL.md 注册成 DSH 运行时技能。
 *
 * 技能正文只维护一份：仓库源文件。这里只加一段“DSH 原生工具优先”的映射，
 * 让模型在 DSH 里不必自己拼 CLI 参数。
 *
 * @module dsh-sgen/skill
 */

import fs from 'node:fs'
import path from 'node:path'

const FALLBACK_DESCRIPTION =
  '本地生图/生视频：用 SGeN 的免费模型生成图片、视频，支持图生图、首尾帧和参考素材。'

const FALLBACK_BODY = `# sgen：生图与生视频

用户需要产出图片/视频文件时，优先使用本插件注册的原生工具：

- \`sgen_image\`：生成图片（默认商汤 sensenova-u1.5-lite，免费）
- \`sgen_video\`：生成视频（默认 Agnes agnes-video-2.5-flash，免费）
- \`sgen_status\`：查询/续等/下载视频任务
- \`sgen_models\`：查看全部模型与限制
- \`sgen_config\`：查看配置或逐把测试 Key

命令行 \`sgen\` 仍然可用；两者读写同一份 \`~/.sgen/config.json\` 和 \`~/.sgen/state.json\`。
`

const PREAMBLE = `# sgen（DSH 插件版）

本技能由 \`dsh-sgen\` 插件提供。DSH 已注册原生工具，**优先使用这些工具**，不要自己拼 HTTP 请求：

| 需求 | 原生工具 |
| --- | --- |
| 生成图片、图生图、多图合成 | \`sgen_image\` |
| 生成视频、首帧/首尾帧、参考图/音频 | \`sgen_video\` |
| 查询/续等/下载视频任务 | \`sgen_status\` |
| 查看全部模型与限制 | \`sgen_models\` |
| 查看配置、逐把测试 Key | \`sgen_config\` |

命令行 \`sgen\` 仍然可用，两种方式行为一致；本机已配置的 Key 不会出现在工具参数或对话里。
内置模型全部当前免费；已退役或收费模型会被 CLI 在本地拦截。
`

/** 解析 SKILL.md 的简单 frontmatter（name/description 两个字段足够）。 */
export function parseSkillDocument(raw) {
  const meta = {}
  let body = String(raw ?? '')
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body)
  if (match) {
    body = body.slice(match[0].length)
    for (const line of match[1].split(/\r?\n/)) {
      const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
      if (!pair) continue
      meta[pair[1]] = pair[2].replace(/^["']|["']$/g, '').trim()
    }
  }
  return { meta, body: body.trim() }
}

/** 读取技能源文件；文件缺失时退回内置的短技能。 */
export function loadSkill(config) {
  const filePath = path.join(config.sgenRoot, 'skill', 'sgen', 'SKILL.md')
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const { meta, body } = parseSkillDocument(raw)
    if (!body) throw new Error('技能正文为空')
    return {
      path: filePath,
      description: meta.description || FALLBACK_DESCRIPTION,
      content: `${PREAMBLE}\n---\n\n${body}\n`,
    }
  } catch {
    return {
      path: filePath,
      description: FALLBACK_DESCRIPTION,
      content: `${PREAMBLE}\n---\n\n${FALLBACK_BODY}`,
    }
  }
}

/**
 * 注册运行时技能。skills 服务是可选的：没有它时宿主工具仍能工作。
 * @param {any} ctx
 * @param {ReturnType<import('./config.js').normalizeConfig>} config
 */
export function registerSkill(ctx, config) {
  const mount = (skillCtx) => {
    const skills = skillCtx.get?.('skills') ?? skillCtx.skills
    if (!skills || typeof skills.register !== 'function') {
      ctx.logger?.warn?.('[sgen] 当前 profile 没有 skills 服务，跳过技能注册')
      return undefined
    }
    const skill = loadSkill(config)
    const dispose = skills.register({
      name: 'sgen',
      description: skill.description,
      whenToUse: skill.description,
      content: skill.content,
      source: 'dsh-sgen',
      path: skill.path,
    })
    skillCtx.effect(() => dispose, 'sgen: skill')
    ctx.logger?.info?.(`[sgen] 已注册技能 sgen（${skill.path}）`)
    return skill
  }
  return typeof ctx.inject === 'function' ? ctx.inject(['skills'], mount) : mount(ctx)
}
