import { usageErr } from './errors.js'

// 图片参数本地校验：只拦截目录中明确知道的限制；未知取值透传给 API（见规格"补充说明"）
// 返回 { size }：档位/比例可能被换算成 API 要求的精确像素
export function validateImageParams(model, { size, ratio } = {}) {
  if (ratio !== undefined && !model.ratios) {
    throw usageErr(`${model.id} 不支持 --ratio（请用 --size 直接指定尺寸）`)
  }
  if (ratio !== undefined && model.ratios && !model.ratios.includes(ratio)) {
    throw usageErr(`--ratio ${ratio} 不被 ${model.id} 支持。可选：${model.ratios.join('、')}`)
  }

  const rules = model.size ?? {}

  if (size === undefined) {
    if (model.pixels) return { size: model.pixels[rules.tiers[0]][ratio ?? '1:1'] }
    return {}
  }

  if (rules.tiers?.includes(size)) {
    if (model.pixels) return { size: model.pixels[size][ratio ?? '1:1'] }
    return { size }
  }

  // 档位常量（1K/2K/4K）→ 长边像素 + 比例换算为精确 WxH（真实接口只收 auto/WxH）
  const kLong = rules.kTiers?.[size.toUpperCase()]
  if (kLong !== undefined) {
    const [rw, rh] = (ratio ?? '1:1').split(':').map(Number)
    const round32 = (n) => Math.round(n / 32) * 32
    const clamp = (n) => Math.min(Math.max(round32(n), rules.wxh.min), rules.wxh.max)
    const [w, h] = rw >= rh ? [clamp(kLong), clamp((kLong * rh) / rw)] : [clamp((kLong * rw) / rh), clamp(kLong)]
    return { size: `${w}x${h}` }
  }

  const wxh = size.match(/^(\d+)[x×](\d+)$/i)
  if (wxh) {
    if (rules.wxh === null || rules.wxh === undefined) {
      throw usageErr(`${model.id} 不支持精确像素写法。--size 可选：${rules.tiers.join('、')}`)
    }
    if (typeof rules.wxh === 'object') {
      const w = Number(wxh[1])
      const h = Number(wxh[2])
      const { min, max, multipleOf, maxRatio } = rules.wxh
      const problems = []
      if (w % multipleOf !== 0 || h % multipleOf !== 0) problems.push(`宽高须为 ${multipleOf} 的倍数`)
      if (w < min || h < min || w > max || h > max) problems.push(`宽高范围 ${min}–${max}`)
      if (Math.max(w / h, h / w) > maxRatio) problems.push(`宽高比不能超过 ${maxRatio}:1`)
      if (problems.length) {
        throw usageErr(`--size ${size} 不满足 ${model.id} 的限制：${problems.join('；')}`)
      }
    }
    return { size }
  }

  // 非档位、非 WxH 的未知取值（如新档位常量）：该模型支持自由写法时透传，否则拦截
  if (rules.kTiers) {
    const w = rules.wxh
    const wxhDesc = `或 WxH（宽高 ${w.min}–${w.max}、${w.multipleOf} 的倍数、比例≤${w.maxRatio}:1）`
    const opts = [...Object.keys(rules.kTiers), ...rules.tiers, wxhDesc]
    throw usageErr(`--size ${size} 不被 ${model.id} 支持。可选：${opts.join('、')}`)
  }
  if (rules.tiers && !rules.wxh) {
    throw usageErr(`--size ${size} 不被 ${model.id} 支持。可选：${rules.tiers.join('、')}`)
  }
  return { size }
}

// 视频参数本地校验：时长范围与尺寸档位来自目录 limits；返回规范化后的取值
export function validateVideoParams(model, { seconds, size, ratio } = {}) {
  if (ratio !== undefined && model.ratios && !model.ratios.includes(ratio)) {
    throw usageErr(`--ratio ${ratio} 不被 ${model.id} 支持。可选：${model.ratios.join('、')}`)
  }

  const tiers = model.size?.tiers
  if (size !== undefined && tiers && !tiers.includes(size)) {
    throw usageErr(`--size ${size} 不被 ${model.id} 支持。可选：${tiers.join('、')}`)
  }

  let secondsOut
  const rule = model.limits?.seconds
  if (seconds !== undefined) {
    if (!rule) {
      // 该模型无时长规则（如 v2.0）：原样透传，由调用方做适用性拦截
      secondsOut = seconds
    } else {
      const n = Number(seconds)
      if (!Number.isInteger(n) || n < rule.min || n > rule.max) {
        throw usageErr(`--seconds ${seconds} 不被 ${model.id} 支持。可选：${rule.min}–${rule.max} 的整数（默认 ${rule.default}）`)
      }
      secondsOut = String(n)
    }
  }
  return { seconds: secondsOut, size, ratio }
}
