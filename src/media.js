import fs from 'node:fs'
import path from 'node:path'
import { usageErr } from './errors.js'

const IMAGE_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

const VIDEO_MIME = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
}

function toDataUri(filePath, mimeMap, what) {
  if (!fs.existsSync(filePath)) {
    throw usageErr(`${what}文件不存在：${filePath}`)
  }
  const mime = mimeMap[path.extname(filePath).toLowerCase()]
  if (!mime) {
    throw usageErr(`不支持的${what}格式：${filePath}（支持 ${Object.keys(mimeMap).join('/')}）`)
  }
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`
}

// 本地媒体 → Data URI（参考素材统一走 Base64，无需图床/对象存储）
export const imageToDataUri = (filePath) => toDataUri(filePath, IMAGE_MIME, '图片')
export const audioToDataUri = (filePath) => toDataUri(filePath, AUDIO_MIME, '音频')
export const videoToDataUri = (filePath) => toDataUri(filePath, VIDEO_MIME, '视频')
