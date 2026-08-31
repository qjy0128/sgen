import { findModel, providerForModelId } from './catalog.js'
import { usageErr } from './errors.js'
import { validateVideoParams } from './validate.js'
import { imageToDataUri, audioToDataUri, videoToDataUri } from './media.js'

function hasItems(value) {
  return Array.isArray(value) && value.length > 0
}

function parseOptionalNumber(value) {
  if (value === undefined) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : value
}

function buildUnknownPlan(modelId, prompt, values) {
  const hasMedia =
    values['first-frame'] !== undefined ||
    values['last-frame'] !== undefined ||
    hasItems(values['ref-image']) ||
    hasItems(values['ref-audio']) ||
    hasItems(values['ref-video'])
  if (hasMedia) {
    throw usageErr(`未知模型 ${modelId} 无法校验媒体参数，请使用内置模型（sgen models 查看）`)
  }
  if (values['video-start'] !== undefined) throw usageErr('--video-start 必须与 --ref-video 一起使用')

  const payload = { model: modelId, prompt, mode: 'text' }
  if (values.seconds !== undefined) payload.seconds = values.seconds
  if (values.size !== undefined) payload.size = values.size
  if (values.ratio !== undefined) payload.aspect_ratio = values.ratio
  if (values['num-frames'] !== undefined) payload.num_frames = parseOptionalNumber(values['num-frames'])
  if (values['frame-rate'] !== undefined) payload.frame_rate = parseOptionalNumber(values['frame-rate'])
  return {
    modelId,
    model: null,
    providerId: providerForModelId(modelId),
    payload,
    mode: 'text',
    warning: `⚠ ${modelId} 不在内置模型目录中，无法判断是否收费，请先到平台确认价格。`,
    normalized: {
      size: values.size ?? null,
      ratio: values.ratio ?? null,
      seconds: parseOptionalNumber(values.seconds) ?? null,
      num_frames: parseOptionalNumber(values['num-frames']) ?? null,
      frame_rate: parseOptionalNumber(values['frame-rate']) ?? null,
    },
  }
}

function dimensions(framesRule, size, ratio) {
  const shortSide = framesRule.shortSides[size] ?? framesRule.shortSides[framesRule.defaultSize]
  const [rw, rh] = ratio.split(':').map(Number)
  const round16 = (n) => Math.round(n / 16) * 16
  return rw >= rh
    ? { width: round16((shortSide * rw) / rh), height: shortSide }
    : { width: shortSide, height: round16((shortSide * rh) / rw) }
}

function paidWarning(model, size, seconds, refImageCount) {
  if (model.free) return null
  const pricing = model.pricing
  if (!pricing?.perSecond) return `⚠ ${model.id} 为收费模型，请先到平台确认价格。`
  const price = pricing.perSecond[size] ?? Object.values(pricing.perSecond)[0]
  const extras = Math.max(0, refImageCount - 5) * (pricing.extraRefImageFrom6 ?? 0)
  const base = seconds * price + extras
  return `⚠ ${model.id} 为收费模型，最低预估费用 ≈ $${base.toFixed(3)}（输出 ${seconds} 秒 × $${price}/秒${extras ? `；额外参考图 $${extras.toFixed(3)}` : ''}；输入视频时长另计）`
}

export function buildVideoPlan({ modelId, prompt, values, explicitlySelected }) {
  const model = findModel(modelId)
  if (!model) return buildUnknownPlan(modelId, prompt, values)
  if (model.provider !== 'agnes') throw usageErr('商汤没有开放视频 API，sgen video 仅支持 Agnes 视频模型（sgen models 查看）')
  if (model.type !== 'video') throw usageErr(`${modelId} 是图片模型，请使用 sgen image`)
  if (!model.free && !explicitlySelected) throw usageErr(`收费模型 ${modelId} 必须用 --model 显式指定`)

  const firstPath = values['first-frame']
  const lastPath = values['last-frame']
  const refImagePaths = values['ref-image'] ?? []
  const refAudioPaths = values['ref-audio'] ?? []
  const refVideoPaths = values['ref-video'] ?? []
  if (lastPath !== undefined && firstPath === undefined) throw usageErr('--last-frame 必须与 --first-frame 一起使用')

  const hasKey = firstPath !== undefined
  const hasRef = refImagePaths.length > 0 || refAudioPaths.length > 0 || refVideoPaths.length > 0
  if (hasKey && hasRef) {
    throw usageErr('首尾帧（--first-frame/--last-frame）与参考素材（--ref-image/--ref-audio/--ref-video）互斥，请二选一')
  }
  const mode = hasKey ? 'keyframe' : hasRef ? 'reference' : 'text'
  if (!model.request.modes.includes(mode)) throw usageErr(`${modelId} 不支持 ${mode} 模式`)

  const mediaRules = model.request.media ?? {}
  if (refVideoPaths.length && !mediaRules.refVideo) {
    throw usageErr(`参考视频（--ref-video）仅收费模型 agnes-video-2.5 支持，${modelId} 不支持`)
  }
  if (refAudioPaths.length && !mediaRules.refAudio) throw usageErr(`${modelId} 不支持 --ref-audio`)
  if (mediaRules.maxRefImages !== null && mediaRules.maxRefImages !== undefined && refImagePaths.length > mediaRules.maxRefImages) {
    throw usageErr(`--ref-image 最多 ${mediaRules.maxRefImages} 张（当前 ${refImagePaths.length} 张）`)
  }

  if (values['video-start'] !== undefined && refVideoPaths.length === 0) {
    throw usageErr('--video-start 必须与 --ref-video 一起使用')
  }
  const videoStart = values['video-start'] === undefined ? 0 : Number(values['video-start'])
  if (!Number.isFinite(videoStart) || videoStart < 0) throw usageErr('--video-start 须为大于或等于 0 的数字')

  const validated = validateVideoParams(model, {
    seconds: values.seconds,
    size: values.size,
    ratio: values.ratio,
  })
  let seconds = validated.seconds
  let size = validated.size
  let ratio = validated.ratio
  let numFrames
  let frameRate

  const framesRule = model.limits?.frames
  if (seconds !== undefined && !model.limits?.seconds) {
    throw usageErr(`--seconds 不适用于 ${modelId}，请用 --num-frames 与 --frame-rate 控制时长`)
  }
  if ((values['num-frames'] !== undefined || values['frame-rate'] !== undefined) && !framesRule) {
    throw usageErr(`--num-frames/--frame-rate 不适用于 ${modelId}`)
  }
  if (values['num-frames'] !== undefined) {
    const n = Number(values['num-frames'])
    if (!Number.isInteger(n) || n < framesRule.min || n > framesRule.max || (n - 1) % framesRule.step !== 0) {
      throw usageErr(`--num-frames 须为 8n+1（如 121）且不超过 ${framesRule.max}`)
    }
    numFrames = n
  }
  if (values['frame-rate'] !== undefined) {
    const f = Number(values['frame-rate'])
    const rule = framesRule.frameRate
    if (!Number.isInteger(f) || f < rule.min || f > rule.max) {
      throw usageErr(`--frame-rate 可选 ${rule.min}–${rule.max}`)
    }
    frameRate = f
  }

  const firstUri = firstPath !== undefined ? imageToDataUri(firstPath) : undefined
  const lastUri = lastPath !== undefined ? imageToDataUri(lastPath) : undefined
  const refImages = refImagePaths.map(imageToDataUri)
  const refAudios = refAudioPaths.map(audioToDataUri)
  const refVideos = refVideoPaths.map((filePath) => ({
    url: videoToDataUri(filePath),
    start_seconds: videoStart,
    require_audio: false,
  }))

  let payload
  if (model.request.family === 'agnes-v20') {
    size ??= framesRule.defaultSize
    ratio ??= framesRule.defaultRatio
    const dims = dimensions(framesRule, size, ratio)
    if (mode === 'keyframe' && lastUri) {
      payload = { model: modelId, prompt, extra_body: { mode: 'keyframes', image: [firstUri, lastUri] }, ...dims }
    } else {
      payload = { model: modelId, prompt, mode: 'ti2vid', ...dims }
      if (firstUri) payload.image = firstUri
    }
    if (numFrames !== undefined) payload.num_frames = numFrames
    if (frameRate !== undefined) payload.frame_rate = frameRate
  } else if (model.request.family === 'agnes-v25') {
    seconds ??= String(model.limits.seconds.default)
    size ??= model.size.tiers[0]
    payload = { model: modelId, prompt, mode, seconds, size }
    if (ratio !== undefined) payload.aspect_ratio = ratio
    if (mode === 'keyframe') {
      payload.first_frame = firstUri
      if (lastUri) payload.last_frame = lastUri
    }
    if (mode === 'reference') {
      if (refImages.length) payload.images = refImages
      if (refAudios.length) payload.audios = refAudios
      if (refVideos.length) payload.videos = refVideos
    }
  } else {
    throw new Error(`未实现的视频请求族：${model.request.family}`)
  }

  return {
    modelId,
    model,
    providerId: model.provider,
    payload,
    mode,
    warning: paidWarning(model, size, Number(seconds ?? 0), refImages.length),
    normalized: {
      size: size ?? null,
      ratio: ratio ?? null,
      seconds: seconds === undefined ? null : Number(seconds),
      num_frames: numFrames ?? null,
      frame_rate: frameRate ?? null,
    },
  }
}
