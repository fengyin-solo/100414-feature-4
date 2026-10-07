import { SEED_ROWS } from './seed'
import { backfillOwnership, GROUND_POWER_KEY } from './ground-power-policy'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'airport-ground-handling:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 历史数据治理：缺归属的地面电源按管辖范围回填归属航站楼。
// 只补「归属航站楼」，受控字段的旧值一律不改；已带归属的记录原样保留。
function applyMigrations(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const groundPower = data[GROUND_POWER_KEY]
  if (!groundPower) {
    return data
  }
  const { rows, changed } = backfillOwnership(groundPower)
  return changed ? { ...data, [GROUND_POWER_KEY]: rows } : data
}

function persist(data: Record<string, EntryRow[]>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = applyMigrations(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    persist(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = applyMigrations({ ...clone(SEED_ROWS), ...parsed })
    // 回填发生时回写一次，之后同一批数据不会再触发
    if (JSON.stringify(merged) !== raw) {
      persist(merged)
    }
    return merged
  } catch {
    persist(fallback)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  persist(next)
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const { rows: migrated } = key === GROUND_POWER_KEY ? backfillOwnership(rows) : { rows }
  saveRows(key, migrated)
  return migrated
}

export function storageKey(): string {
  return STORAGE_KEY
}
