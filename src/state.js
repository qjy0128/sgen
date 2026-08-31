import os from 'node:os'
import path from 'node:path'
import { readJsonFile, updateJsonFile } from './json-store.js'

const MAX_TASKS = 100

export function statePath() {
  return path.join(os.homedir(), '.sgen', 'state.json')
}

export function readState() {
  return readJsonFile(statePath(), {})
}

export function updateState(updater) {
  try {
    return updateJsonFile(statePath(), updater)
  } catch {
    // 状态只用于便利功能；写失败不能盖过生成结果
    return null
  }
}

export function readProviderCursor(providerId) {
  return readState()[providerId]?.cursor ?? 0
}

export function writeProviderCursor(providerId, cursor) {
  updateState((state) => ({ ...state, [providerId]: { ...(state[providerId] ?? {}), cursor } }))
}

export function rememberVideoTask(videoId, model, keyFingerprint) {
  updateState((state) => {
    const tasks = Array.isArray(state.tasks) ? state.tasks : []
    const existing = tasks.find((x) => x?.video_id === videoId) ?? {}
    const task = {
      ...existing,
      video_id: videoId,
      model,
      ...(keyFingerprint ? { key_fingerprint: keyFingerprint } : {}),
      created_at: existing.created_at ?? Date.now(),
    }
    return { ...state, tasks: [task, ...tasks.filter((x) => x?.video_id !== videoId)].slice(0, MAX_TASKS) }
  })
}

export function findVideoTask(videoId) {
  const tasks = readState().tasks
  return Array.isArray(tasks) ? tasks.find((x) => x?.video_id === videoId) ?? null : null
}
