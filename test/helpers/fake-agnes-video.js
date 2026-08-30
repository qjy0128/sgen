import { startServer, readBody } from './server.js'

const MP4_BYTES = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 1, 2, 3, 4])

// 模拟 Agnes 视频异步任务流：
// POST /v1/videos 建任务；GET /agnesapi?video_id=&model_name= 轮询（每查一次推进状态）；
// completeAfterPolls 次轮询后 completed 并给出 mp4 地址；failWith 非空则 failed；
// rateLimitPolls：前 N 次查询返回 429（模拟状态查询独立限流）
export async function fakeAgnesVideo(
  t,
  { key = 'ak-test', completeAfterPolls = 2, failWith = null, rateLimitPolls = 0 } = {},
) {
  const creations = []
  const polls = []
  const tasks = new Map()
  let n = 0
  const { server, url } = await startServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/v1/videos') {
      const body = await readBody(req)
      const presented = req.headers.authorization?.replace(/^Bearer /, '')
      creations.push({ auth: req.headers.authorization, body })
      if (presented !== key) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: '未提供令牌' } }))
        return
      }
      n += 1
      const videoId = `vid-${n}`
      tasks.set(videoId, { polls: 0 })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          id: videoId,
          task_id: `task-${n}`,
          video_id: videoId,
          status: 'queued',
          seconds: body.seconds,
          size: body.size,
        }),
      )
      return
    }
    if (req.method === 'GET' && req.url.startsWith('/agnesapi')) {
      const u = new URL(req.url, 'http://localhost')
      const videoId = u.searchParams.get('video_id')
      const modelName = u.searchParams.get('model_name')
      polls.push({ videoId, modelName, auth: req.headers.authorization })
      const task = tasks.get(videoId)
      if (!task) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'task not found' } }))
        return
      }
      task.polls += 1
      if (task.polls <= rateLimitPolls) {
        res.writeHead(429, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { code: 429, message: 'video status query rate limit exceeded' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      if (failWith) {
        res.end(JSON.stringify({ status: 'failed', error: { message: failWith } }))
        return
      }
      if (task.polls >= completeAfterPolls) {
        res.end(
          JSON.stringify({ status: 'completed', progress: 100, metadata: { url: `${url}/clip.mp4` } }),
        )
      } else {
        res.end(JSON.stringify({ status: 'in_progress', progress: task.polls * 40 }))
      }
      return
    }
    if (req.url === '/clip.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end(MP4_BYTES)
      return
    }
    res.writeHead(404)
    res.end()
  })
  t.after(() => server.close())
  return { url, creations, polls, mp4: MP4_BYTES }
}
