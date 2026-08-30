async function extractErrorMessage(res) {
  try {
    const json = await res.json()
    return json?.error?.message ?? json?.message ?? json?.detail ?? ''
  } catch {
    return ''
  }
}

// 两家供应商共用的 POST 封装：统一人话报错与退出码分类（api=1 / network=1）
export async function postJson(url, { apiKey, body, label }) {
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    })
  } catch (err) {
    const origin = (() => {
      try {
        return new URL(url).origin
      } catch {
        return url
      }
    })()
    throw Object.assign(new Error(`无法连接${label}（${origin}）：${err.message}`), { kind: 'network' })
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
