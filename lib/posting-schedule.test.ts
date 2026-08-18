import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getPostingReminder } from './posting-schedule.ts'

// 2026-08-16T04:00Z = 台灣週日中午，之後每天 +1
const SUN = new Date('2026-08-16T04:00:00Z')
const day = (offset: number) => new Date(SUN.getTime() + offset * 86400000)

test('七天都回傳非空提醒', () => {
  for (let i = 0; i < 7; i++) {
    assert.ok(getPostingReminder(day(i)).length > 0)
  }
})

test('週日為休息、不發文', () => {
  assert.match(getPostingReminder(day(0)), /休息/)
})

test('週一與週三為台灣傳產必追', () => {
  assert.match(getPostingReminder(day(1)), /台灣傳產必追/)
  assert.match(getPostingReminder(day(3)), /台灣傳產必追/)
})

test('週五為本週製造快訊', () => {
  assert.match(getPostingReminder(day(5)), /製造快訊/)
})
