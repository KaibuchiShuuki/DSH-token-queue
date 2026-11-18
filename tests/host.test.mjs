/**
 * 宿主半边的离线冒烟：用假的 ctx / req / res 跑一遍真实的路由处理。
 * 不打真实 DSH，也不碰用户真实的 ~/.dsh/token-queue（命令里把 USERPROFILE 指到临时目录）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import * as plugin from '../lib/index.js'
import { readState } from '../lib/engine.js'

const HOST = '127.0.0.1:56905'

function fakeReq({ method = 'GET', body = '', host = HOST } = {}) {
  const req = new Readable({ read() {} })
  req.method = method
  req.headers = { host }
  req.push(body ? Buffer.from(body) : null)
  req.push(null)
  return req
}

function fakeRes() {
  let settle
  const done = new Promise((resolve) => {
    settle = resolve
  })
  const res = {
    statusCode: 200,
    headers: {},
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers || {})
    },
    end(chunk) {
      settle({ status: this.statusCode, headers: this.headers, body: chunk ? String(chunk) : '' })
    },
  }
  return { res, done }
}

function makeHarness() {
  const routes = new Map()
  const calls = { created: [] }
  const schedule = {
    async create(request) {
      calls.created.push(request)
      return { id: 'task-' + calls.created.length }
    },
  }
  const sessions = [
    { id: 's-new', createdAt: 2000, title: '新会话', live: true },
    { id: 's-old', createdAt: 1000, title: '老会话', live: false },
  ]
  const sessionQuery = {
    async listSessions() {
      return sessions.map((s) => ({
        header: { id: s.id, createdAt: s.createdAt, cwd: 'D:/x' },
        live: s.live,
        persisted: true,
      }))
    },
    async readTitleSnapshots(ids) {
      return ids.map((sessionId) => {
        const found = sessions.find((s) => s.id === sessionId)
        return {
          sessionId,
          status: 'fulfilled',
          value: found && found.title ? { title: { title: found.title } } : {},
        }
      })
    },
  }
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return dispose
    },
    webServer: {
      register({ path: p, handler }) {
        routes.set(p, handler)
        return () => routes.delete(p)
      },
    },
    get(name) {
      if (name === 'connection') return { requestRejection: () => undefined }
      if (name === 'schedule') return schedule
      if (name === 'sessionQuery') return sessionQuery
      return undefined
    },
  }
  plugin.apply(ctx)

  async function call(routePath, { method = 'GET', body, host = HOST } = {}) {
    const handler = routes.get('/dsh-token-queue/api' + routePath)
    assert.ok(handler, '缺少路由 ' + routePath)
    const { res, done } = fakeRes()
    handler(fakeReq({ method, body: body === undefined ? '' : JSON.stringify(body), host }), res)
    const out = await done
    return { status: out.status, json: out.body ? JSON.parse(out.body) : null }
  }

  return { call, calls, schedule, sessionQuery, routes }
}

// 把用户目录指到临时沙箱，避免碰真实的 ~/.dsh/token-queue。
// engine.js 只在调用时读 os.homedir()，所以在 import 之后改 env 仍然有效。
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tq-home-'))
process.env.USERPROFILE = sandbox
process.env.HOME = sandbox
const realState = path.join(sandbox, '.dsh', 'token-queue', 'queue.json')
fs.mkdirSync(path.dirname(realState), { recursive: true })

function resetQueue(settings = {}) {
  fs.writeFileSync(realState, JSON.stringify({ version: 1, settings, items: [] }))
}

test.after(() => {
  fs.rmSync(sandbox, { recursive: true, force: true })
})

test('GET /state 返回设置、时段与计数', async () => {
  resetQueue()
  const h = makeHarness()
  const out = await h.call('/state')
  assert.equal(out.status, 200)
  assert.equal(out.json.ok, true)
  assert.equal(out.json.settings.peakWindows.length, 2)
  assert.ok(['峰价', '谷价'].includes(out.json.phase.label))
  assert.equal(typeof out.json.phase.nextChangeAt, 'string')
  assert.equal(out.json.counts.pending, 0)
})

test('加入 / 编辑 / 删除：峰价时只存不发', async () => {
  resetQueue()
  const h = makeHarness()
  const set = await h.call('/settings', {
    method: 'POST',
    body: { settings: { enabled: false, peakWindows: [{ start: '00:00', end: '23:59' }], weekendsValley: false } },
  })
  assert.equal(set.json.snapshot.settings.enabled, false)
  const added = await h.call('/items', {
    method: 'POST',
    body: { texts: ['第一条\n第二条', '第三条'], target: { kind: 'new' } },
  })
  assert.equal(added.json.added.length, 3, '一行一条：两行文本 + 一条文本 = 三条')
  assert.equal(readState().items.length, 3)
  assert.equal(h.calls.created.length, 0, '自动派发关着，不该建任务')

  const id = readState().items[0].id
  const edited = await h.call('/items/update', { method: 'POST', body: { id, text: '改过的指令' } })
  assert.equal(edited.json.snapshot.items[0].text, '改过的指令')

  const removed = await h.call('/items/delete', { method: 'POST', body: { ids: [id] } })
  assert.equal(removed.json.removed, 1)
  assert.equal(readState().items.length, 2)
})

test('手动派发：每条转成一个 Schedule at 任务，目标照传', async () => {
  resetQueue()
  const h = makeHarness()
  await h.call('/settings', {
    method: 'POST',
    body: { settings: { enabled: false, peakWindows: [{ start: '00:00', end: '23:59' }], dispatchGapSeconds: 2 } },
  })
  await h.call('/items', { method: 'POST', body: { texts: ['新会话的任务'], target: { kind: 'new' } } })
  await h.call('/items', { method: 'POST', body: { texts: ['发给旧会话'], target: { kind: 'session', sessionId: 's-old' } } })

  const out = await h.call('/dispatch', { method: 'POST', body: {} })
  assert.equal(out.json.ok, true)
  assert.equal(out.json.results.length, 2)
  assert.equal(h.calls.created.length, 2)

  const [first, second] = h.calls.created
  assert.equal(first.target.kind, 'new')
  assert.equal(second.target.kind, 'session')
  assert.equal(second.target.sessionId, 's-old')
  assert.equal(first.timing.kind, 'at')
  assert.ok(Date.parse(first.timing.at) > Date.now(), 'at 必须落在未来')
  assert.equal(first.title, '新会话的任务')

  const st = readState()
  assert.equal(st.items.filter((i) => i.status === 'sent').length, 2)
  assert.ok(st.items.every((i) => i.scheduleId))
})

test('派发失败标记 failed，重试回到 pending', async () => {
  resetQueue()
  const h = makeHarness()
  await h.call('/settings', {
    method: 'POST',
    body: { settings: { enabled: false, peakWindows: [{ start: '00:00', end: '23:59' }] } },
  })
  await h.call('/items', { method: 'POST', body: { texts: ['会失败的任务'], target: { kind: 'new' } } })

  const original = h.schedule.create
  h.schedule.create = async () => {
    throw new Error('会话创建失败')
  }
  const bad = await h.call('/dispatch', { method: 'POST', body: {} })
  assert.equal(bad.json.results[0].ok, false)
  assert.equal(readState().items[0].status, 'failed')
  assert.match(readState().items[0].error, /会话创建失败/)

  h.schedule.create = original
  const retried = await h.call('/items/retry', { method: 'POST', body: {} })
  assert.equal(retried.json.retried, 1)
  assert.equal(readState().items[0].status, 'pending')
})

test('GET /sessions 返回标题与时间', async () => {
  resetQueue()
  const h = makeHarness()
  const out = await h.call('/sessions')
  assert.equal(out.status, 200)
  assert.equal(out.json.sessions.length, 2)
  assert.equal(out.json.sessions[0].id, 's-new')
  assert.equal(out.json.sessions[0].title, '新会话')
  assert.equal(out.json.sessions[0].live, true)
})

test('非回环 Host 被拒', async () => {
  resetQueue()
  const h = makeHarness()
  const out = await h.call('/state', { host: 'evil.example.com' })
  assert.equal(out.status, 403)
  assert.equal(out.json.ok, false)
})
