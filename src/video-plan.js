import { findModel, providerForModelId, unsupportedModelReason } from './catalog.js'
import { usageErr } from './errors.js'
import { validateVideoParams } from './validate.js'
import { imageToDataUri, audioToDataUri } from './media.js'

function hasItems(value) {
  return Array.isArray(value) && value.length > 0
}

function buildUnknownPlan(modelId, prompt, values) {
  const hasMedia =
    values['first-frame'] !== undefined ||
    values['last-frame'] !== undefined ||
    hasItems(values['ref-image']) ||
    hasItems(values['ref-audio'])
  if (hasMedia) {
    throw usageErr(`未知模型 ${modelId} 无法校验媒体参数，请使用内置模型（sgen models 查看）`)
  }

  const payload = { model: modelId, prompt, mode: 'text' }
  if (values.seconds !== undefined) payload.seconds = values.seconds
  if (values.size !== undefined) payload.size = values.size
  if (values.ratio !== undefined) payload.aspect_ratio = values.ratio
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
      seconds: values.seconds === undefined ? null : Number(values.seconds),
    },
  }
}

export function buildVideoPlan({ modelId, prompt, values }) {
  const unsupported = unsupportedModelReason(modelId)
  if (unsupported) throw usageErr(unsupported)

  const model = findModel(modelId)
  if (!model) return buildUnknownPlan(modelId, prompt, values)
  if (model.provider !== 'agnes') throw usageErr('商汤没有开放视频 API，sgen video 仅支持 Agnes 视频模型（sgen models 查看）')
  if (model.type !== 'video') throw usageErr(`${modelId} 是图片模型，请使用 sgen image`)

  const firstPath = values['first-frame']
  const lastPath = values['last-frame']
  const refImagePaths = values['ref-image'] ?? []
  const refAudioPaths = values['ref-audio'] ?? []
  if (lastPath !== undefined && firstPath === undefined) throw usageErr('--last-frame 必须与 --first-frame 一起使用')

  const hasKey = firstPath !== undefined
  const hasRef = refImagePaths.length > 0 || refAudioPaths.length > 0
  if (hasKey && hasRef) {
    throw usageErr('首尾帧（--first-frame/--last-frame）与参考素材（--ref-image/--ref-audio）互斥，请二选一')
  }
  const mode = hasKey ? 'keyframe' : hasRef ? 'reference' : 'text'
  if (!model.request.modes.includes(mode)) throw usageErr(`${modelId} 不支持 ${mode} 模式`)

  const mediaRules = model.request.media ?? {}
  if (refAudioPaths.length && !mediaRules.refAudio) throw usageErr(`${modelId} 不支持 --ref-audio`)
  if (mediaRules.maxRefImages !== null && mediaRules.maxRefImages !== undefined && refImagePaths.length > mediaRules.maxRefImages) {
    throw usageErr(`--ref-image 最多 ${mediaRules.maxRefImages} 张（当前 ${refImagePaths.length} 张）`)
  }

  const validated = validateVideoParams(model, {
    seconds: values.seconds,
    size: values.size,
    ratio: values.ratio,
  })
  let seconds = validated.seconds
  let size = validated.size
  const ratio = validated.ratio

  const firstUri = firstPath !== undefined ? imageToDataUri(firstPath) : undefined
  const lastUri = lastPath !== undefined ? imageToDataUri(lastPath) : undefined
  const refImages = refImagePaths.map(imageToDataUri)
  const refAudios = refAudioPaths.map(audioToDataUri)

  seconds ??= String(model.limits.seconds.default)
  size ??= model.size.tiers[0]
  const payload = { model: modelId, prompt, mode, seconds, size }
  if (ratio !== undefined) payload.aspect_ratio = ratio
  if (mode === 'keyframe') {
    payload.first_frame = firstUri
    if (lastUri) payload.last_frame = lastUri
  }
  if (mode === 'reference') {
    if (refImages.length) payload.images = refImages
    if (refAudios.length) payload.audios = refAudios
  }

  return {
    modelId,
    model,
    providerId: model.provider,
    payload,
    mode,
    warning: null,
    normalized: {
      size: size ?? null,
      ratio: ratio ?? null,
      seconds: Number(seconds),
    },
  }
}
