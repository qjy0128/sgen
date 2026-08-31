// 更新检查的后台子进程入口：由主进程以 detached 方式启动。
// 一天最多拉取一次远端 package.json 的版本写入 state.json；任何失败静默（只影响提示，不影响使用）。
import { DEFAULT_CHECK_URL, CHECK_INTERVAL_MS } from './update.js'
import { updateState } from './state.js'

const FETCH_TIMEOUT_MS = 5000
const CHECK_LEASE_MS = 60_000

async function main() {
  try {
    let claimed = false
    const claimedState = updateState((state) => {
      const now = Date.now()
      if (now - (state.checkedAt ?? 0) < CHECK_INTERVAL_MS) return state
      if (now - (state.updateCheckStartedAt ?? 0) < CHECK_LEASE_MS) return state
      claimed = true
      return { ...state, updateCheckStartedAt: now }
    })
    if (!claimed || !claimedState) return

    let remoteVersion
    try {
      const url = process.env.SGEN_UPDATE_CHECK_URL ?? DEFAULT_CHECK_URL
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      if (res.ok) {
        const json = await res.json()
        if (typeof json?.version === 'string') remoteVersion = json.version
      }
    } catch {
      // 离线/超时：同样记 checkedAt，当天不再重试
    }
    updateState((current) => {
      const { updateCheckStartedAt, ...state } = current
      return {
        ...state,
        checkedAt: Date.now(),
        ...(remoteVersion ? { remoteVersion } : {}),
      }
    })
  } catch {
    // 状态读写失败：静默
  }
}

main()
