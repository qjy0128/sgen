import { postJson, httpTimeoutMs, networkErrText } from './api.js'

// Agnes 生图：size 用档位常量，ratio 为原生参数；
// 依官方文档 response_format 必须嵌在 extra_body 中（顶层会 400），参考图走 extra_body.image 数组
export async function generateImage({ baseUrl, apiKey, prompt, model, size, ratio, images }) {
  const body = { model, prompt }
  if (size) body.size = size
  if (ratio) body.ratio = ratio
  body.extra_body = { response_format: 'url' }
  if (images?.length) body.extra_body.image = images

  const json = await postJson(`${baseUrl}/images/generations`, { apiKey, body, label: 'Agnes' })

  const url = json?.data?.[0]?.url
  if (!url) throw Object.assign(new Error('Agnes 返回中没有图片 URL'), { kind: 'api' })
  return url
}

// 视频任务创建：POST /v1/videos（异步），返回 video_id
export async function createVideoTask({ baseUrl, apiKey, payload }) {
  const json = await postJson(`${baseUrl}/videos`, { apiKey, body: payload, label: 'Agnes' })
  const videoId = json?.video_id ?? json?.id
  if (!videoId) {
    throw Object.assign(new Error('Agnes 创建视频任务失败（返回缺少 video_id）'), { kind: 'api' })
  }
  return { videoId: String(videoId), taskId: json?.task_id, status: json?.status ?? 'queued' }
}

// 视频任务查询：GET <域名根>/agnesapi?video_id=&model_name=（2.5 系列轮询需带 model_name）
export async function queryVideoTask({ baseUrl, apiKey, videoId, model, timeoutMs = httpTimeoutMs() }) {
  const origin = new URL(baseUrl).origin
  const params = new URLSearchParams({ video_id: videoId })
  if (model) params.set('model_name', model)

  let res
  try {
    res = await fetch(`${origin}/agnesapi?${params}`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    throw Object.assign(new Error(`无法查询 Agnes 视频任务：${networkErrText(err)}`), { kind: 'network' })
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw Object.assign(
      new Error(`查询视频任务失败（HTTP ${res.status}）${text ? '：' + text.slice(0, 200) : ''}`),
      { kind: 'api', status: res.status, rotatable: false },
    )
  }
  return res.json()
}
