/**
 * dsh-token-queue —— 纯逻辑半边：峰谷时段判定 + 队列文件读写。
 *
 * 这里不碰 DSH 的任何服务，方便用 node 直接单测（tests/engine.test.mjs）。
 * 所有时间按**本机时区**解释：DeepSeek 的峰谷是按北京时间算的，宿主进程跑在
 * 用户自己机器上，本地时区就是用户看到的时间。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

const DAY_MINUTES = 24 * 60

export function statePath() {
  return path.join(os.homedir(), '.dsh', 'token-queue', 'queue.json')
}

export const DEFAULT_SETTINGS = {
  /** 总开关：关掉后只在手动「立即发送」时派发。 */
  enabled: true,
  /** 高峰区间（本地时间，左闭右开）。谷价 = 其余全部时间。 */
  peakWindows: [
    { start: '09:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  /** 周六周日整天按谷价。 */
  weekendsValley: true,
  /** 法定节假日（本地日期 YYYY-MM-DD，整天按谷价）。 */
  holidays: [],
  /** 多条任务派发时每条错开多少秒（at 必须落在未来）。 */
  dispatchGapSeconds: 3,
}

export const DEFAULT_STATE = () => ({
  version: 1,
  settings: clone(DEFAULT_SETTINGS),
  items: [],
})

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function pad(n) {
  return String(n).padStart(2, '0')
}

/** 本地日期 YYYY-MM-DD。 */
export function localDateKey(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/** "09:00" -> 540；非法返回 null。 */
export function parseClock(text) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(text || '').trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return h * 60 + min
}

/** 合并重叠/相邻的窗口，保证 nextChange 的候选点不重复也不漏。 */
export function normalizeWindows(windows) {
  const out = []
  for (const w of Array.isArray(windows) ? windows : []) {
    const start = parseClock(w && w.start)
    const end = parseClock(w && w.end)
    if (start === null || end === null || start === end) continue
    out.push({ start, end })
  }
  out.sort((a, b) => a.start - b.start)
  const merged = []
  for (const w of out) {
    const last = merged[merged.length - 1]
    if (last && w.start <= last.end) last.end = Math.max(last.end, w.end)
    else merged.push({ ...w })
  }
  return merged
}

export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const windows = normalizeWindows(
    input.peakWindows === undefined ? DEFAULT_SETTINGS.peakWindows : input.peakWindows,
  ).map((w) => ({
    start: pad(Math.floor(w.start / 60)) + ':' + pad(w.start % 60),
    end: pad(Math.floor(w.end / 60)) + ':' + pad(w.end % 60),
  }))
  const holidays = Array.isArray(input.holidays)
    ? [...new Set(input.holidays.map((x) => String(x).trim()).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)))].slice(0, 400)
    : []
  const gap = Number(input.dispatchGapSeconds)
  return {
    enabled: input.enabled === undefined ? DEFAULT_SETTINGS.enabled : !!input.enabled,
    peakWindows: windows,
    weekendsValley:
      input.weekendsValley === undefined ? DEFAULT_SETTINGS.weekendsValley : !!input.weekendsValley,
    holidays,
    dispatchGapSeconds: Number.isFinite(gap) ? Math.min(Math.max(Math.round(gap), 1), 60) : DEFAULT_SETTINGS.dispatchGapSeconds,
  }
}

/** 该日期是否整天按谷价（法定节假日）。 */
export function isHoliday(date, settings) {
  return (settings.holidays || []).includes(localDateKey(date))
}

/** 当前是否高峰时段。 */
export function isPeak(date, settings) {
  if (isHoliday(date, settings)) return false
  const dow = date.getDay()
  if (settings.weekendsValley && (dow === 0 || dow === 6)) return false
  const minutes = date.getHours() * 60 + date.getMinutes()
  return normalizeWindows(settings.peakWindows).some((w) => minutes >= w.start && minutes < w.end)
}

/**
 * 下一个「峰/谷切换」时刻（epoch ms）。最多看 14 天，找不到返回 null。
 * 候选点 = 每天 0 点 + 每个窗口的起止点；状态与当前不同的第一个即答案。
 */
export function nextChangeAt(date, settings) {
  const now = date.getTime()
  const current = isPeak(date, settings)
  const windows = normalizeWindows(settings.peakWindows)
  const candidates = []
  for (let i = 0; i <= 14; i += 1) {
    const midnight = new Date(date.getTime())
    midnight.setHours(0, 0, 0, 0)
    midnight.setDate(midnight.getDate() + i)
    candidates.push(midnight.getTime())
    for (const w of windows) {
      const s = new Date(midnight.getTime())
      s.setHours(Math.floor(w.start / 60), w.start % 60, 0, 0)
      candidates.push(s.getTime())
      const e = new Date(midnight.getTime())
      e.setHours(Math.floor(w.end / 60), w.end % 60, 0, 0)
      candidates.push(e.getTime())
    }
  }
  candidates.sort((a, b) => a - b)
  for (const t of candidates) {
    if (t <= now) continue
    if (isPeak(new Date(t), settings) !== current) return t
  }
  return null
}

/** 当前时段摘要，给 UI 直接渲染。 */
export function phaseInfo(date, settings) {
  const peak = isPeak(date, settings)
  const changeAt = nextChangeAt(date, settings)
  return {
    peak,
    label: peak ? '峰价' : '谷价',
    nextChangeAt: changeAt === null ? null : new Date(changeAt).toISOString(),
    nextValleyAt: peak && changeAt !== null ? new Date(changeAt).toISOString() : null,
  }
}

/** 标题：第一行最多 60 字。 */
export function makeTitle(text) {
  const first = String(text || '')
    .split(/\r?\n/)[0]
    .trim()
  if (!first) return '排队任务'
  return first.length > 60 ? first.slice(0, 60) + '…' : first
}

/** 校验并规范化一条任务的投递目标。 */
export function sanitizeTarget(target) {
  const input = target && typeof target === 'object' ? target : {}
  if (input.kind === 'session' && typeof input.sessionId === 'string' && input.sessionId.trim()) {
    return { kind: 'session', sessionId: input.sessionId.trim() }
  }
  const create = {}
  if (typeof input.cwd === 'string' && input.cwd.trim()) create.cwd = input.cwd.trim()
  return { kind: 'new', ...(Object.keys(create).length ? { create } : {}) }
}

export function newItem(text, target) {
  const body = String(text || '').trim()
  return {
    id: randomUUID(),
    text: body,
    title: makeTitle(body),
    target: sanitizeTarget(target),
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = String(raw.text || '').trim()
  if (!text) return null
  const status = ['pending', 'sent', 'failed'].includes(raw.status) ? raw.status : 'pending'
  const item = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
    text,
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : makeTitle(text),
    target: sanitizeTarget(raw.target),
    status,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  }
  if (typeof raw.sentAt === 'string') item.sentAt = raw.sentAt
  if (typeof raw.scheduleId === 'string') item.scheduleId = raw.scheduleId
  if (typeof raw.error === 'string' && raw.error) item.error = raw.error
  return item
}

export function sanitizeState(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const items = Array.isArray(input.items) ? input.items.map(sanitizeItem).filter(Boolean).slice(0, 500) : []
  return {
    version: 1,
    settings: sanitizeSettings(input.settings),
    items,
  }
}

export function readState(file = statePath()) {
  try {
    return sanitizeState(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return DEFAULT_STATE()
  }
}

export function writeState(state, file = statePath()) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(sanitizeState(state), null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/** 把队列项的目标翻成 schedule 服务认识的结构。 */
export function toScheduleTarget(target) {
  if (target && target.kind === 'session') return { kind: 'session', sessionId: target.sessionId }
  if (target && target.create && target.create.cwd) return { kind: 'new', create: { cwd: target.create.cwd } }
  return { kind: 'new' }
}

export { DAY_MINUTES }
