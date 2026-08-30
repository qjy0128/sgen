import { postJson } from './api.js'

// 商汤生图：有参考图走 /images/edits，否则 /images/generations
export async function generateImage({ baseUrl, apiKey, prompt, model = 'sensenova-u1.5-lite', size, images }) {
  const body = {
    model,
    prompt,
    watermark: false,
    response_format: 'url',
    output_format: 'png',
  }
  if (size) body.size = size
  if (images?.length) body.images = images

  const endpoint = images?.length ? '/images/edits' : '/images/generations'
  const json = await postJson(`${baseUrl}${endpoint}`, { apiKey, body, label: '商汤' })

  const url = json?.data?.[0]?.url
  if (!url) throw Object.assign(new Error('商汤返回中没有图片 URL'), { kind: 'api' })
  return url
}
