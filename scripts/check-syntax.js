#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const roots = ['bin', 'src', 'test', 'scripts']

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(dir, entry.name)
    if (entry.isDirectory()) return jsFiles(filePath)
    return entry.isFile() && filePath.endsWith('.js') ? [filePath] : []
  })
}

for (const filePath of roots.flatMap(jsFiles)) {
  const result = spawnSync(process.execPath, ['--check', filePath], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('JavaScript 语法检查通过')
