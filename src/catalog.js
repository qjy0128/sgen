// 模型目录：全部能力/限制数据驱动，新模型只需在此加一条记录
// size 语义：tiers=档位常量；wxh=true 允许精确像素（不本地校验）；wxh 为对象则按规则校验；wxh=null 不支持精确像素
// pixels：档位+比例 → 服务端实际要求的精确像素（仅商汤 u1-fast 需要）
// ratios：支持 --ratio 的模型列出可选值；null 表示不支持该参数

export const PROVIDERS = {
  sensenova: { label: '商汤', base_url: 'https://token.sensenova.cn/v1' },
  agnes: { label: 'Agnes', base_url: 'https://apihub.agnes-ai.com/v1' },
}

export const DEFAULT_IMAGE_MODEL = 'sensenova-u1.5-lite'
export const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5-flash'

export const MODELS = [
  {
    id: 'sensenova-u1.5-lite',
    provider: 'sensenova',
    type: 'image',
    isDefault: true,
    free: true,
    sync: true,
    caps: ['文生图', '图生图'],
    // 真实接口只收 auto 或 WIDTHxHEIGHT（32 倍数、512–4096、≤3:1）；
    // 1K/2K/4K 档位由工具本地换算为精确像素（kTiers=长边像素）
    size: {
      tiers: ['auto'],
      wxh: { min: 512, max: 4096, multipleOf: 32, maxRatio: 3 },
      kTiers: { '1K': 1024, '2K': 2048, '4K': 4096 },
    },
    ratios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9'],
    note: '公测免费 1500 次/5 小时；结果 URL 24 小时失效，工具已自动下载',
  },
  {
    id: 'sensenova-u1-fast',
    provider: 'sensenova',
    type: 'image',
    free: true,
    sync: true,
    caps: ['文生图'],
    size: { tiers: ['1K', '2K'], wxh: null },
    ratios: ['1:1', '16:9', '9:16', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:21'],
    pixels: {
      '1K': {
        '1:1': '1344x1344',
        '16:9': '1792x992',
        '9:16': '992x1792',
        '2:3': '1088x1632',
        '3:2': '1632x1088',
        '3:4': '1152x1536',
        '4:3': '1536x1152',
        '4:5': '1184x1472',
        '5:4': '1472x1184',
        '9:21': '864x2048',
      },
      '2K': {
        '1:1': '2048x2048',
        '16:9': '2752x1536',
        '9:16': '1536x2752',
        '2:3': '1664x2496',
        '3:2': '2496x1664',
        '3:4': '1760x2368',
        '4:3': '2368x1760',
        '4:5': '1824x2272',
        '5:4': '2272x1824',
        '9:21': '1344x3136',
      },
    },
    note: '推理生图/信息图见长；仅 1K/2K',
  },
  {
    id: 'agnes-image-2.1-flash',
    provider: 'agnes',
    type: 'image',
    free: true,
    sync: true,
    caps: ['文生图', '图生图'],
    size: { tiers: ['1K', '2K', '3K', '4K'], wxh: true },
    ratios: ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9'],
    note: '限免 $0；图生图前 3 张参考图免费',
  },
  {
    id: 'agnes-image-2.0-flash',
    provider: 'agnes',
    type: 'image',
    free: true,
    sync: true,
    caps: ['文生图', '图生图'],
    size: { tiers: null, wxh: true },
    ratios: null,
    note: '限免 $0；尺寸用精确像素写法（如 1024x768）',
  },
  {
    id: 'agnes-video-v2.0',
    provider: 'agnes',
    type: 'video',
    free: true,
    sync: false,
    caps: ['文生视频', '首帧', '首尾帧'],
    size: { tiers: ['480p', '720p', '1080p'], wxh: null },
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    seconds: '按帧数：num_frames≤441 且 8n+1，frame_rate 1–60（约 18 秒封顶）',
    limits: { frames: { max: 441, defaultSize: '720p', defaultRatio: '16:9' } },
    note: '限免 $0/秒',
  },
  {
    id: 'agnes-video-2.5-flash',
    provider: 'agnes',
    type: 'video',
    isDefault: true,
    free: true,
    sync: false,
    caps: ['文生视频', '首帧', '首尾帧', '参考图≤5', '参考音频'],
    size: { tiers: ['720P'], wxh: null },
    ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    seconds: '4–12 秒（默认 5）',
    limits: { seconds: { min: 4, max: 12, default: 5 } },
    note: '限免 $0/秒；不支持参考视频',
  },
  {
    id: 'agnes-video-2.5',
    provider: 'agnes',
    type: 'video',
    free: false,
    sync: false,
    caps: ['文生视频', '首帧', '首尾帧', '参考图', '参考音频', '参考视频'],
    size: { tiers: ['720P', '960P', '2K'], wxh: null },
    ratios: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
    seconds: '4–12 秒（默认 5）',
    limits: { seconds: { min: 4, max: 12, default: 5 } },
    pricing: { perSecond: { '720P': 0.025, '960P': 0.04, '2K': 0.055 }, extraRefImageFrom6: 0.005 },
    note: '收费：720P $0.025/秒、960P $0.040/秒、2K $0.055/秒（计费=输出+输入视频秒数）',
  },
]

export function findModel(id) {
  return MODELS.find((m) => m.id === id) ?? null
}

// 未知模型的路由启发：按名称前缀归到供应商，其余默认商汤
export function providerForModelId(id) {
  return id.startsWith('agnes') ? 'agnes' : 'sensenova'
}

export function renderModels() {
  const lines = []
  for (const [type, label] of [
    ['image', '图片模型'],
    ['video', '视频模型'],
  ]) {
    lines.push(`${label}：`)
    for (const m of MODELS.filter((x) => x.type === type)) {
      const parts = [
        `  ${m.id}`,
        `[${PROVIDERS[m.provider].label}]`,
        `${m.free ? '免费' : '收费'}·${m.sync ? '同步' : '异步'}${m.isDefault ? '·默认' : ''}`,
        m.caps.join('/'),
      ]
      if (m.size?.tiers) {
        parts.push(`尺寸: ${m.size.tiers.join('/')}${m.size.wxh ? ' 或 WxH' : ''}`)
      } else if (m.size?.wxh) {
        parts.push('尺寸: WxH 精确像素')
      }
      if (m.ratios) parts.push(`比例: ${m.ratios.join('/')}`)
      if (m.seconds) parts.push(`时长: ${m.seconds}`)
      if (m.note) parts.push(`（${m.note}）`)
      lines.push(parts.join('  '))
    }
    lines.push('')
  }
  lines.push(`默认模型：sgen image → ${DEFAULT_IMAGE_MODEL}；sgen video → ${DEFAULT_VIDEO_MODEL}`)
  lines.push('详细限制说明见项目 README。')
  return lines.join('\n')
}
