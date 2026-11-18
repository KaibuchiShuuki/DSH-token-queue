import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_SETTINGS,
  isPeak,
  localDateKey,
  makeTitle,
  nextChangeAt,
  normalizeWindows,
  phaseInfo,
  readState,
  sanitizeSettings,
  sanitizeState,
  sanitizeTarget,
  writeState,
} from '../lib/engine.js'

const settings = (patch) => sanitizeSettings({ ...DEFAULT_SETTINGS, ...patch })
const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0)
const hm = (ms) => {
  const d = new Date(ms)
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
}

test('工作日高峰区间判定', () => {
  const s = settings({})
  assert.equal(isPeak(at(2026, 11, 18, 8, 59), s), false)
  assert.equal(isPeak(at(2026, 11, 18, 9, 0), s), true)
  assert.equal(isPeak(at(2026, 11, 18, 11, 59), s), true)
  assert.equal(isPeak(at(2026, 11, 18, 12, 0), s), false)
  assert.equal(isPeak(at(2026, 11, 18, 13, 59), s), false)
  assert.equal(isPeak(at(2026, 11, 18, 14, 0), s), true)
  assert.equal(isPeak(at(2026, 11, 18, 18, 0), s), false)
  assert.equal(isPeak(at(2026, 11, 18, 23, 30), s), false)
})

test('周末与法定节假日整天算谷价', () => {
  const s = settings({})
  assert.equal(isPeak(at(2026, 11, 21, 10, 0), s), false) // 周六
  const holiday = settings({ holidays: [localDateKey(at(2026, 11, 18, 0, 0))] })
  assert.equal(isPeak(at(2026, 11, 18, 10, 0), holiday), false)
  const open = settings({ weekendsValley: false })
  assert.equal(isPeak(at(2026, 11, 21, 10, 0), open), true)
})

test('下一个切换时刻', () => {
  const s = settings({})
  assert.equal(hm(nextChangeAt(at(2026, 11, 18, 8, 0), s)), '9:00')
  assert.equal(hm(nextChangeAt(at(2026, 11, 18, 10, 30), s)), '12:00')
  assert.equal(hm(nextChangeAt(at(2026, 11, 18, 13, 0), s)), '14:00')
  assert.equal(hm(nextChangeAt(at(2026, 11, 18, 17, 30), s)), '18:00')
  // 周三 19:00 → 下一个状态变化是周四 09:00（中间一直是谷价）
  assert.equal(hm(nextChangeAt(at(2026, 11, 18, 19, 0), s)), '9:00')
  // 周五 19:00 → 周六整天谷价，下一个峰是周一 09:00
  assert.equal(hm(nextChangeAt(at(2026, 11, 20, 19, 0), s)), '9:00')
})

test('phaseInfo 给出峰/谷与下一次谷价起点', () => {
  const s = settings({})
  const peak = phaseInfo(at(2026, 11, 18, 10, 0), s)
  assert.equal(peak.peak, true)
  assert.equal(peak.label, '峰价')
  assert.equal(hm(Date.parse(peak.nextValleyAt)), '12:00')
  const valley = phaseInfo(at(2026, 11, 18, 20, 0), s)
  assert.equal(valley.peak, false)
  assert.equal(valley.nextValleyAt, null)
})

test('窗口规范化：排序并合并重叠区间', () => {
  assert.deepEqual(
    normalizeWindows([
      { start: '14:00', end: '18:00' },
      { start: '09:00', end: '12:00' },
      { start: '11:00', end: '13:00' },
      { start: 'oops', end: '10:00' },
    ]),
    [
      { start: 540, end: 780 },
      { start: 840, end: 1080 },
    ],
  )
})

test('设置净化：非法值回落默认', () => {
  const s = sanitizeSettings({
    enabled: 'yes',
    peakWindows: [{ start: '9:00', end: '12:00' }, { start: 'bogus', end: '10:00' }],
    dispatchGapSeconds: 999,
    holidays: ['2026-10-01', 'bad', '2026-10-01'],
  })
  assert.equal(s.enabled, true)
  assert.deepEqual(s.peakWindows, [{ start: '09:00', end: '12:00' }])
  assert.equal(s.dispatchGapSeconds, 60)
  assert.deepEqual(s.holidays, ['2026-10-01'])
})

test('标题取第一行并截断', () => {
  assert.equal(makeTitle('第一行\n第二行'), '第一行')
  assert.equal(makeTitle('   '), '排队任务')
  assert.equal(makeTitle('x'.repeat(80)).length, 61)
})

test('目标规范化', () => {
  assert.deepEqual(sanitizeTarget({ kind: 'session', sessionId: 's1' }), { kind: 'session', sessionId: 's1' })
  assert.deepEqual(sanitizeTarget({ kind: 'session' }), { kind: 'new' })
  assert.deepEqual(sanitizeTarget({ kind: 'new', cwd: 'D:/x' }), { kind: 'new', create: { cwd: 'D:/x' } })
})

test('队列文件往返', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tq-'))
  const file = path.join(dir, 'queue.json')
  const state = {
    settings: { enabled: false, peakWindows: [{ start: '10:00', end: '11:00' }], holidays: ['2026-12-25'] },
    items: [
      { id: 'a', text: '做点事', target: { kind: 'new' }, status: 'pending', createdAt: '2026-11-17T10:00:00.000Z' },
      { id: 'b', text: '发给旧会话', target: { kind: 'session', sessionId: 's9' }, status: 'sent', createdAt: '2026-11-17T10:00:00.000Z', sentAt: '2026-11-17T11:00:00.000Z', scheduleId: 't1' },
    ],
  }
  writeState(state, file)
  const back = readState(file)
  assert.equal(back.settings.enabled, false)
  assert.equal(back.items.length, 2)
  assert.equal(back.items[1].target.sessionId, 's9')
  assert.equal(back.items[1].scheduleId, 't1')
  assert.equal(back.items[0].title, '做点事')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('脏数据不会让 readState 抛错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-tq-'))
  const file = path.join(dir, 'queue.json')
  fs.writeFileSync(file, '{not json')
  const back = readState(file)
  assert.equal(back.items.length, 0)
  assert.equal(back.settings.dispatchGapSeconds, 3)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('sanitizeState 丢掉空文本条目', () => {
  const s = sanitizeState({ items: [{ text: '  ' }, { text: 'ok' }] })
  assert.equal(s.items.length, 1)
  assert.equal(s.items[0].text, 'ok')
})
