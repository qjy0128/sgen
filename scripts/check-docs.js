#!/usr/bin/env node
import fs from 'node:fs'
import { MODELS, DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, assertCatalog } from '../src/catalog.js'

assertCatalog()
const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8')
const skill = fs.readFileSync(new URL('../skill/sgen/SKILL.md', import.meta.url), 'utf8')
const errors = []

for (const model of MODELS) {
  if (!readme.includes(`\`${model.id}\``)) errors.push(`README 缺少模型：${model.id}`)
}
for (const id of [DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL]) {
  if (!skill.includes(id)) errors.push(`Skill 缺少默认模型：${id}`)
}
for (const [name, text] of [['README', readme], ['Skill', skill]]) {
  if (text.includes('~/Coding/imagegen')) errors.push(`${name} 仍含旧目录 ~/Coding/imagegen`)
}
for (const token of ['--force', '生成请求不会自动重试', '结构化 JSON']) {
  if (!readme.includes(token)) errors.push(`README 缺少关键说明：${token}`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log('模型目录、README 与 Skill 一致性检查通过')
