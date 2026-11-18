/**
 * dsh-token-queue —— 宿主半边
 *
 * 一条队列：界面里写多条待办，峰价时段只存；到了谷价时段，每条各派一个
 * 会话（或发给指定已有会话）开始干活。
 *
 * 派发不自己造 Session：借用 DSH 自带的 Schedule 服务（ctx.schedule），
 * 建一个「at ≈ 现在」的一次性任务，target 取 new / session。
 * Schedule 会负责建会话、写用户消息、启动 agent 回合。
 *
 * 路由前缀故意不用 /api：DSH 的 /api 只有官方 RPC 用，插件蹭那个前缀会被信任栅栏挡。
 */
import {
  phaseInfo,
  readState,
  sanitizeState,
  sanitizeTarget,
  statePath,
  makeTitle,
  newItem,
  writeState,
} from './engine.js'

export const name = 'dsh-token-queue'
export const inject = ['webServer', 'connection']

const PREFIX = '/dsh-token-queue/api'
const TICK_MS = 15 * 1000
const START_DELAY_MS = 5 * 1000
const MAX_BATCH = 50
const MAX_TEXT = 8000

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

function readBody(req, limit = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function errText(err) {
  return String(err && err.message ? err.message : err)
}

/** 文本 -> 若干条指令：一行一条，空行忽略。 */
function splitLines(input) {
  // 数组里每一项本身也可能带换行（前端可能按行传数组），统一再拆一遍
  const list = Array.isArray(input)
    ? input.flatMap((one) => String(one || '').split(/\r?\n/))
    : String(input || '').split(/\r?\n/)
  const out = []
  for (const raw of list) {
    const text = String(raw || '').trim()
    if (!text) continue
    if (text.length > MAX_TEXT) throw new Error('单条指令最多 ' + MAX_TEXT + ' 字')
    out.push(text)
    if (out.length > MAX_BATCH) throw new Error('一次最多加入 ' + MAX_BATCH + ' 条')
  }
  if (!out.length) throw new Error('没有可加入的指令')
  return out
}

export function apply(ctx) {
  let timer = null
  let startTimer = null
  let dispatching = false

  /** 信任栅栏：只认本机回环 + DSH 自己的 connection 判定；不可用时 fail-closed。 */
  function blocked(req, res) {
    const host = String(req.headers && req.headers.host ? req.headers.host : '').toLowerCase()
    const bare = host.replace(/^\[|\](?=:)/g, '').split(':')[0]
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(bare)) {
      json(res, 403, { ok: false, error: '只接受本机回环访问' })
      return true
    }
    try {
      const conn = ctx.get('connection') || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') {
        json(res, 503, { ok: false, error: '信任栅栏不可用，拒绝访问' })
        return true
      }
      const code = conn.requestRejection(req)
      if (code === undefined || code === null || code === false) return false
      res.statusCode = typeof code === 'number' ? code : 403
      res.end()
      return true
    } catch {
      json(res, 503, { ok: false, error: '信任栅栏异常，拒绝访问' })
      return true
    }
  }

  function route(pathname, handler) {
    ctx.effect(
      () =>
        ctx.webServer.register({
          kind: 'exact',
          path: pathname,
          handler: async (req, res) => {
            if (blocked(req, res)) return
            try {
              await handler(req, res)
            } catch (err) {
              try {
                json(res, 500, { ok: false, error: errText(err) })
              } catch {
                /* 响应可能已经发出 */
              }
            }
          },
        }),
      'dsh-token-queue: ' + pathname,
    )
  }

  function scheduleService() {
    const schedule = ctx.get('schedule') || ctx.schedule
    return schedule && typeof schedule.create === 'function' ? schedule : null
  }

  function settings() {
    return readState().settings
  }

  /**
   * 把 pending 的条目逐条交给 Schedule 服务。每条 at 往后错开 gap 秒。
   * 派发失败的条目标 failed 并保留错误，界面可以重试。
   */
  async function dispatchPending({ ignoreWindow = false } = {}) {
    if (dispatching) return { ok: false, error: '上一轮派发还在进行' }
    const schedule = scheduleService()
    if (!schedule) return { ok: false, error: 'Schedule 服务不可用（这个配置档没加载 dsh-schedule？）' }

    const before = readState()
    if (!ignoreWindow) {
      if (!before.settings.enabled) return { ok: true, skipped: 'disabled', results: [] }
      const phase = phaseInfo(new Date(), before.settings)
      if (phase.peak) return { ok: true, skipped: 'peak', results: [] }
    }
    const pending = before.items.filter((item) => item.status === 'pending')
    if (!pending.length) return { ok: true, skipped: 'empty', results: [] }

    dispatching = true
    const gap = Math.max(1, Number(before.settings.dispatchGapSeconds) || 3) * 1000
    const results = []
    try {
      for (let i = 0; i < pending.length; i += 1) {
        const item = pending[i]
        const at = new Date(Date.now() + (i + 1) * gap + 1000).toISOString()
        try {
          const entry = await schedule.create({
            title: item.title || makeTitle(item.text),
            prompt: item.text,
            timing: { kind: 'at', at },
            target:
              item.target && item.target.kind === 'session'
                ? { kind: 'session', sessionId: item.target.sessionId }
                : item.target && item.target.create && item.target.create.cwd
                  ? { kind: 'new', create: { cwd: item.target.create.cwd } }
                  : { kind: 'new' },
          })
          const next = readState()
          const live = next.items.find((x) => x.id === item.id)
          if (live) {
            live.status = 'sent'
            live.sentAt = new Date().toISOString()
            live.scheduleId = entry && (entry.id || entry.taskId) ? String(entry.id || entry.taskId) : undefined
            delete live.error
            writeState(next)
          }
          results.push({ id: item.id, ok: true, at, scheduleId: live ? live.scheduleId : undefined })
        } catch (err) {
          const next = readState()
          const live = next.items.find((x) => x.id === item.id)
          if (live) {
            live.status = 'failed'
            live.error = errText(err)
            writeState(next)
          }
          results.push({ id: item.id, ok: false, error: errText(err) })
        }
      }
    } finally {
      dispatching = false
    }
    return { ok: true, results }
  }

  async function tick() {
    try {
      const st = readState()
      if (!st.settings.enabled) return
      if (!st.items.some((item) => item.status === 'pending')) return
      if (phaseInfo(new Date(), st.settings).peak) return
      await dispatchPending()
    } catch (err) {
      console.warn('[dsh-token-queue] 自动派发失败：' + errText(err))
    }
  }

  function startTimers() {
    if (timer) clearInterval(timer)
    timer = setInterval(() => {
      void tick()
    }, TICK_MS)
    if (typeof timer.unref === 'function') timer.unref()
    startTimer = setTimeout(() => {
      void tick()
    }, START_DELAY_MS)
    if (typeof startTimer.unref === 'function') startTimer.unref()
  }

  function snapshot() {
    const st = readState()
    return {
      ok: true,
      settings: st.settings,
      items: st.items,
      phase: phaseInfo(new Date(), st.settings),
      now: Date.now(),
      statePath: statePath(),
      scheduleReady: !!scheduleService(),
      counts: {
        pending: st.items.filter((i) => i.status === 'pending').length,
        sent: st.items.filter((i) => i.status === 'sent').length,
        failed: st.items.filter((i) => i.status === 'failed').length,
      },
    }
  }

  route(PREFIX + '/state', async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, error: '只支持 GET' })
      return
    }
    json(res, 200, snapshot())
  })

  route(PREFIX + '/items', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    const body = JSON.parse((await readBody(req)) || '{}')
    const texts = splitLines(body.texts !== undefined ? body.texts : body.text)
    const target = sanitizeTarget(body.target)
    const st = readState()
    const added = texts.map((text) => newItem(text, target))
    st.items.push(...added)
    writeState(st)
    const phase = phaseInfo(new Date(), st.settings)
    // 谷价时段加入的就别等下一轮 tick 了，直接派。
    if (!phase.peak && st.settings.enabled) {
      void dispatchPending()
    }
    json(res, 200, { ok: true, added: added.map((i) => i.id), snapshot: snapshot() })
  })

  route(PREFIX + '/items/update', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    const body = JSON.parse((await readBody(req)) || '{}')
    const id = String(body.id || '')
    const st = readState()
    const item = st.items.find((x) => x.id === id)
    if (!item) {
      json(res, 404, { ok: false, error: '找不到这条任务（可能已经被派发或删除）' })
      return
    }
    if (item.status !== 'pending') {
      json(res, 409, { ok: false, error: '已经派发的任务不能改' })
      return
    }
    if (body.text !== undefined) {
      const text = String(body.text || '').trim()
      if (!text) {
        json(res, 400, { ok: false, error: '指令不能为空' })
        return
      }
      if (text.length > MAX_TEXT) {
        json(res, 400, { ok: false, error: '单条指令最多 ' + MAX_TEXT + ' 字' })
        return
      }
      item.text = text
      item.title = makeTitle(text)
    }
    if (body.target !== undefined) item.target = sanitizeTarget(body.target)
    writeState(st)
    json(res, 200, { ok: true, snapshot: snapshot() })
  })

  route(PREFIX + '/items/delete', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    const body = JSON.parse((await readBody(req)) || '{}')
    const list = Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : []
    const ids = new Set(list.map(String).filter(Boolean))
    if (!ids.size) {
      json(res, 400, { ok: false, error: '没给 id' })
      return
    }
    const st = readState()
    const before = st.items.length
    st.items = st.items.filter((item) => !ids.has(item.id))
    writeState(st)
    json(res, 200, { ok: true, removed: before - st.items.length, snapshot: snapshot() })
  })

  route(PREFIX + '/items/retry', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    const body = JSON.parse((await readBody(req)) || '{}')
    const list = Array.isArray(body.ids) ? body.ids : body.id !== undefined ? [body.id] : []
    const ids = new Set(list.map(String).filter(Boolean))
    const st = readState()
    let count = 0
    for (const item of st.items) {
      if (item.status !== 'failed') continue
      if (ids.size && !ids.has(item.id)) continue
      item.status = 'pending'
      delete item.error
      count += 1
    }
    writeState(st)
    if (count && !phaseInfo(new Date(), st.settings).peak) void dispatchPending()
    json(res, 200, { ok: true, retried: count, snapshot: snapshot() })
  })

  route(PREFIX + '/dispatch', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    const result = await dispatchPending({ ignoreWindow: true })
    json(res, 200, { ...result, snapshot: snapshot() })
  })

  route(PREFIX + '/settings', async (req, res) => {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: '只支持 POST' })
      return
    }
    const body = JSON.parse((await readBody(req)) || '{}')
    const st = readState()
    st.settings = sanitizeState({ settings: body.settings, items: [] }).settings
    writeState(st)
    json(res, 200, { ok: true, snapshot: snapshot() })
  })

  route(PREFIX + '/sessions', async (req, res) => {
    if (req.method !== 'GET') {
      json(res, 405, { ok: false, error: '只支持 GET' })
      return
    }
    const sq = ctx.get('sessionQuery') || ctx.sessionQuery
    if (!sq || typeof sq.listSessions !== 'function') {
      json(res, 503, { ok: false, error: '会话服务不可用' })
      return
    }
    const records = await sq.listSessions()
    const rows = records
      .map((rec) => ({
        id: rec.header.id,
        createdAt: rec.header.createdAt,
        cwd: rec.header.cwd || '',
        parent: rec.header.parentSession || null,
        live: !!rec.live,
      }))
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 120)
    const titles = new Map()
    try {
      const observed = await sq.readTitleSnapshots(rows.map((row) => row.id))
      for (const one of observed) {
        if (one && one.status === 'fulfilled' && one.value && one.value.title) {
          titles.set(one.sessionId, one.value.title.title)
        }
      }
    } catch {
      /* 标题拿不到就退回创建时间显示 */
    }
    json(res, 200, {
      ok: true,
      sessions: rows.map((row) => ({ ...row, title: titles.get(row.id) || '' })),
    })
  })

  startTimers()

  ctx.effect(
    () => () => {
      if (timer) clearInterval(timer)
      if (startTimer) clearTimeout(startTimer)
      timer = null
      startTimer = null
    },
    'dsh-token-queue: scheduler',
  )
}
