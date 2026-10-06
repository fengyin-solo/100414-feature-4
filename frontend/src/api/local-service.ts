import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  CONTROLLED_FIELDS,
  CREW_SCHEDULE_KEY,
  EDITABLE_FIELDS,
  EDITABLE_STATUSES,
  GROUND_POWER_KEY,
  SHARED_READONLY_FIELDS,
  isControlledRecord,
  isMaintenanceGroup,
  maintenanceUnitOf,
  releaseCrewTodos,
} from '@/data/governance'
import { appendAudit, listAudit, rememberResult, replayResult } from '@/data/records-store'
import type {
  ActionResult,
  AuditChange,
  AuditEntry,
  Identity,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false })
}

function identityKey(identity?: Identity): string {
  return identity ? identity.unit : 'anonymous'
}

function audit(entry: Omit<AuditEntry, 'time' | 'operator' | 'unit'>, identity?: Identity): void {
  appendAudit({
    ...entry,
    time: nowText(),
    operator: identity?.operator ?? '未登录值班',
    unit: identity?.unit ?? '未知单位',
  })
}

// ---- 地面电源：权限与归属护栏 ----------------------------------------------------

function ensureOwner(identity: Identity | undefined, row: EntryRow): ActionResult | null {
  if (!identity) {
    return { ok: false, message: '未识别值班单位身份，提交已拦截' }
  }
  if (identity.kind !== 'maintenance' || identity.terminal === null) {
    return {
      ok: false,
      message: `越权拦截：地面电源受控信息仅航站楼维护组可改动，${identity.unit}只有查看权限`,
    }
  }
  const terminal = String(row['归属航站楼'] ?? '')
  if (identity.unit !== maintenanceUnitOf(terminal)) {
    return {
      ok: false,
      message: `越权拦截：该设备归属${terminal}航站楼（${maintenanceUnitOf(terminal)}），${identity.unit}无权改动`,
    }
  }
  return null
}

export function createGroundPower(
  draft: Record<string, string>,
  identity?: Identity,
  requestId?: string,
): ActionResult {
  const entity = '地面电源'
  if (requestId && identity) {
    const cached = replayResult(requestId, identityKey(identity))
    if (cached) {
      return { ...cached, message: `${cached.message}（重复提交，已按一次生效）` }
    }
  }
  if (!identity || identity.kind !== 'maintenance' || identity.terminal === null) {
    const result = {
      ok: false,
      message: `越权拦截：地面电源登记仅航站楼维护组可操作，${identity?.unit ?? '未知单位'}只有查看权限`,
    }
    audit({ module: GROUND_POWER_KEY, recordId: null, action: '登记地面电源', ok: false, message: result.message, requestId }, identity)
    return result
  }

  const code = draft['设备编号']?.trim() ?? ''
  if (!code) {
    return { ok: false, message: '设备编号不能为空' }
  }
  const rows = listRows(GROUND_POWER_KEY)
  if (rows.some((row) => String(row['设备编号']) === code)) {
    return { ok: false, message: `设备编号 ${code} 已存在，不能重复登记` }
  }
  const standCode = draft['所属机位']?.trim() ?? ''
  if (!standCode) {
    return { ok: false, message: '所属机位不能为空（共享机位信息由机位分配模块下发）' }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const row: EntryRow = {
    id,
    status: '待机',
    pending: true,
    abnormal: false,
    '设备编号': code,
    '设备类型': draft['设备类型']?.trim() ?? '',
    '所属机位': standCode,
    '输出电压': draft['输出电压']?.trim() ?? '',
    '额定电流': draft['额定电流']?.trim() ?? '',
    '归属航站楼': identity.terminal,
    '维护单位': identity.unit,
    '归属来源': '登记归属',
    '供电开始': '',
    '供电结束': '',
    '设备状态': '待机',
  }
  saveRows(GROUND_POWER_KEY, [...rows, row])
  const result = { ok: true, message: `地面电源 ${code} 已登记，归属${identity.terminal}航站楼维护组` }
  audit({ module: GROUND_POWER_KEY, recordId: id, action: '登记地面电源', ok: true, message: result.message, requestId }, identity)
  if (requestId) {
    rememberResult(requestId, identityKey(identity), result)
  }
  return result
}

export function updateGroundPower(
  id: number,
  patch: Record<string, string>,
  identity?: Identity,
  requestId?: string,
): ActionResult {
  const rows = listRows(GROUND_POWER_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地面电源` }
  }
  const row = rows[index]

  if (requestId && identity) {
    const cached = replayResult(requestId, identityKey(identity))
    if (cached) {
      return { ...cached, message: `${cached.message}（重复提交，已按一次生效）` }
    }
  }

  // 1) 越权提交直接拦截：非本航站楼维护组连表单都不该到这，到了也在服务层挡住。
  const denied = ensureOwner(identity, row)
  if (denied) {
    audit({ module: GROUND_POWER_KEY, recordId: id, action: '修改受控信息', ok: false, message: denied.message, requestId }, identity)
    return denied
  }

  // 2) 共享机位信息保持只读：任何单位都不能通过编辑入口改所属机位。
  const touchedShared = SHARED_READONLY_FIELDS.filter((field) => {
    const next = (patch[field] ?? '').trim()
    return next !== '' && next !== String(row[field] ?? '')
  })
  if (touchedShared.length > 0) {
    const result = { ok: false, message: `共享机位信息只读：「${touchedShared.join('、')}」由机位分配模块维护，不能在此修改` }
    audit({ module: GROUND_POWER_KEY, recordId: id, action: '修改受控信息', ok: false, message: result.message, requestId }, identity)
    return result
  }

  // 3) 受控记录的旧值不能改动：已离开待机态（供过电/报修）的设备，受控字段锁死。
  const controlledLocked = isControlledRecord(row)
  const lockedTouches = controlledLocked
    ? CONTROLLED_FIELDS.filter((field) => {
        if (!(field in patch)) {
          return false
        }
        return patch[field]!.trim() !== String(row[field] ?? '')
      })
    : []
  if (lockedTouches.length > 0) {
    const result = { ok: false, message: `该设备已进入「${row.status}」受控状态，旧值锁死，「${lockedTouches.join('、')}」不能改动` }
    audit({ module: GROUND_POWER_KEY, recordId: id, action: '修改受控信息', ok: false, message: result.message, requestId }, identity)
    return result
  }

  // 白名单落库：只有允许的字段会被写入，其余提交键一律忽略。
  const changes: AuditChange[] = []
  const updated: EntryRow = { ...row }
  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) {
      continue
    }
    const next = String(patch[field] ?? '').trim()
    const oldValue = updated[field] ?? ''
    if (next !== String(oldValue)) {
      changes.push({ field, old: oldValue, next })
      updated[field] = next
    }
  }
  if (changes.length === 0) {
    return { ok: false, message: '没有检测到字段变化' }
  }

  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows(GROUND_POWER_KEY, nextRows)
  const result = { ok: true, message: `地面电源 ${updated['设备编号']} 的受控信息已更新（${changes.length} 项）` }
  // 旧值快照进入只追加审计档：受控记录旧值因此永久可查、不可被覆盖。
  audit({ module: GROUND_POWER_KEY, recordId: id, action: '修改受控信息', ok: true, message: result.message, changes, requestId }, identity)
  if (requestId) {
    rememberResult(requestId, identityKey(identity!), result)
  }
  return result
}

// ---- 通用动作：地面电源叠加护栏 + 断电联动 ----------------------------------------

export function runAction(key: string, id: number, action: string, identity?: Identity, requestId?: string): ActionResult {
  const meta = moduleMeta(key)

  if (requestId && identity) {
    const cached = replayResult(requestId, identityKey(identity))
    if (cached) {
      return { ...cached, message: `${cached.message}（重复提交，已按一次生效）` }
    }
  }

  let result: ActionResult

  if (key === GROUND_POWER_KEY) {
    result = runGroundPowerAction(meta, id, action, identity)
  } else {
    result = runGenericAction(meta, key, id, action)
  }

  audit(
    {
      module: key,
      recordId: id,
      action,
      ok: result.ok,
      message: result.message,
      requestId,
    },
    identity,
  )
  if (requestId && identity && result.ok) {
    rememberResult(requestId, identityKey(identity), result)
  }
  return result
}

function runGenericAction(meta: ModuleMeta, key: string, id: number, action: string): ActionResult {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function runGroundPowerAction(meta: ModuleMeta, id: number, action: string, identity?: Identity): ActionResult {
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(GROUND_POWER_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const row = rows[index]

  // 状态流转同样属于受控操作：非本航站楼维护组直接拦截。
  const denied = ensureOwner(identity, row)
  if (denied) {
    return denied
  }

  const current = String(row.status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态机护栏：只能在待机/供电中/故障等合理状态间流转，乱序提交拦截，且保证重复操作不二次生效。
  if (action === '开始供电' && current !== '待机') {
    return { ok: false, message: `当前为「${current}」，只有待机设备可以开始供电` }
  }
  if (action === '结束供电' && current !== '供电中') {
    return { ok: false, message: `当前为「${current}」，只有供电中设备可以确认断电` }
  }
  if (action === '停用报修' && (current !== '待机' && current !== '供电中')) {
    return { ok: false, message: `当前为「${current}」，该状态不能停用报修` }
  }

  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const stamp = nowText()
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  if (action === '开始供电') {
    updated['供电开始'] = stamp
  }
  if (action === '结束供电') {
    updated['供电结束'] = stamp
  }

  const next = [...rows]
  next[index] = updated
  saveRows(GROUND_POWER_KEY, next)

  // 确认断电后，其它入口（地勤排班清单）关联该设备的待办同步释放，只生效一次。
  let suffix = ''
  if (action === '结束供电') {
    const deviceCode = String(updated['设备编号'] ?? '')
    const crewRows = listRows(CREW_SCHEDULE_KEY)
    const { next: crewNext, released } = releaseCrewTodos(crewRows, deviceCode)
    if (released.length > 0) {
      saveRows(CREW_SCHEDULE_KEY, crewNext)
      const codes = released.map((item) => `${item.crewCode}（${item.previousStatus}→已释放）`).join('、')
      audit(
        {
          module: CREW_SCHEDULE_KEY,
          recordId: null,
          action: '断电联动释放待办',
          ok: true,
          message: `地面电源 ${deviceCode} 已断电，同步释放地勤排班待办 ${released.length} 条：${codes}`,
        },
        identity,
      )
      suffix = `；已同步释放地勤排班待办 ${released.length} 条：${codes}`
    } else {
      suffix = '；地勤排班清单无关联待办需要释放'
    }
  }

  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${suffix}` }
}

export function recordTrail(moduleKey: string, recordId?: number): AuditEntry[] {
  return listAudit(moduleKey, recordId)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// 供页面复用的归属判断，避免视图里再写一遍权限规则。
export { isMaintenanceGroup, maintenanceUnitOf }
