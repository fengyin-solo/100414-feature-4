import type { ActionResult, AuditEntry } from './types'

// 受控档案 + 幂等登记：都只追加、不提供改写入口，刷新后仍在。
const AUDIT_KEY = 'airport-ground-handling:audit'
const IDEMPOTENT_KEY = 'airport-ground-handling:requests'
const AUDIT_LIMIT = 500
const RESULT_LIMIT = 1000

function readList<T>(key: string): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return []
  }
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T[]) : []
  } catch {
    return []
  }
}

function writeList<T>(key: string, list: T[], limit: number): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const trimmed = list.slice(-limit)
  window.localStorage.setItem(key, JSON.stringify(trimmed))
}

export function appendAudit(entry: AuditEntry): AuditEntry[] {
  const list = readList<AuditEntry>(AUDIT_KEY)
  list.push(entry)
  writeList(AUDIT_KEY, list, AUDIT_LIMIT)
  return list
}

export function listAudit(moduleKey?: string, recordId?: number): AuditEntry[] {
  return readList<AuditEntry>(AUDIT_KEY)
    .filter((entry) => (moduleKey ? entry.module === moduleKey : true))
    .filter((entry) => (recordId === undefined ? true : entry.recordId === recordId))
    .reverse()
}

function resultKey(requestId: string, identityKey: string): string {
  return `${identityKey}::${requestId}`
}

/** 重复提交拦截：同一个 requestId 第二次进来，直接返回首次已落库的结果，动作不会再执行。 */
export function replayResult(requestId: string, identityKey: string): ActionResult | null {
  const list = readList<{ key: string; result: ActionResult }>(IDEMPOTENT_KEY)
  const hit = list.find((item) => item.key === resultKey(requestId, identityKey))
  return hit ? hit.result : null
}

export function rememberResult(requestId: string, identityKey: string, result: ActionResult): void {
  // 只有真正生效的提交才登记幂等结果；被拦截的提交换条件后应允许重新提交。
  if (!result.ok) {
    return
  }
  const list = readList<{ key: string; result: ActionResult }>(IDEMPOTENT_KEY)
  list.push({ key: resultKey(requestId, identityKey), result })
  writeList(IDEMPOTENT_KEY, list, RESULT_LIMIT)
}
