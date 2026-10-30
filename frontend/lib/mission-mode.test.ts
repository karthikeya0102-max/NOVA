import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readMissionModePreference, writeMissionModePreference } from './mission-mode.ts'

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

test('Mission Mode defaults to ON when no preference has been saved', () => {
  assert.equal(readMissionModePreference(createStorage()), true)
})

test('an explicit OFF preference overrides the ON default', () => {
  assert.equal(readMissionModePreference(createStorage({ 'nova-mission-mode': 'false' })), false)
})

test('an explicit ON preference remains enabled', () => {
  assert.equal(readMissionModePreference(createStorage({ 'nova-mission-mode': 'true' })), true)
})

test('user changes persist across reloads and clearing the preference restores ON', () => {
  const storage = createStorage()
  writeMissionModePreference(storage, false)
  assert.equal(readMissionModePreference(storage), false)
  writeMissionModePreference(storage, true)
  assert.equal(readMissionModePreference(storage), true)
  const clearedStorage = createStorage()
  assert.equal(readMissionModePreference(clearedStorage), true)
})
