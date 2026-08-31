async function extractErrorMessage(res) {
  try {
    const json = await res.json()
    return json?.error?.message ?? json?.message ?? json?.detail ?? ''
  } catch {
    return ''
  }
}

// 单次 HTTP 调用的整体超时：默认 300 秒，可用 SGEN_HTTP_TIMEOUT_MS 覆写（慢链路调优/测试用）
const DEFAULT_HTTP_TIMEOUT_MS = 300_000
export function httpTimeoutMs() {
  const n = Number(process.env.SGEN_HTTP_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HTTP_TIMEOUT_MS
}

// 超时错误统一成人话；其余网络错误透传原始 message
export function networkErrText(err) {
  return err.name === 'TimeoutError' ? `请求超时（${Math.round(httpTimeoutMs() / 1000)} 秒）` : err.message
}

// 两家供应商共用的 POST 封装：统一人话报错与退出码分类（api=1 / network=1）
export async function postJson(url, { apiKey, body, label }) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(httpTimeoutMs()),
    })
  } catch (err) {
    const origin = (() => {
      try {
        return new URL(url).origin
      } catch {
        return url
      }
    })()
    throw Object.assign(
      new Error(
        `无法连接${label}（${origin}）：${networkErrText(err)}\n生成请求未自动重试，避免重复生成或重复扣费；若平台可能已收到请求，请先到控制台检查。`,
      ),
      { kind: 'network', uncertain: true },
    )
  }

  if (!res.ok) {
    const detail = await extractErrorMessage(res)
    let msg = `${label}请求失败（HTTP ${res.status}）${detail ? '：' + detail : ''}`
    if (res.status === 401 || res.status === 403) {
      msg += '\n请检查 Key 是否正确，或运行 sgen config init 重新配置。'
    }
    throw Object.assign(new Error(msg), { kind: 'api', status: res.status })
  }
  return res.json()
}
