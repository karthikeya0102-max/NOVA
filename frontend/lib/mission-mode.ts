const STORAGE_KEY = 'nova-mission-mode'

export function readMissionModePreference(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(STORAGE_KEY) !== 'false'
}

export function writeMissionModePreference(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(STORAGE_KEY, String(enabled))
}
