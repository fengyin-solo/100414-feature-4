import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  CONTROLLED_FIELDS,
  CREW_KEY,
  GROUND_POWER_KEY,
  OWNED_TERMINAL_FIELD,
  actorTerminal,
  isOwningActor,
  isSharedStand,
  terminalOfStand,
} from '@/data/ground-power-policy'
import type { Actor } from '@/stores/session'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 地勤排班状态机里的末态：进入末态即代表待办已释放
const CREW_RELEASED_STATUS = '已离岗'

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

// 确认断电后，把其它入口（地勤排班清单）里仍挂在该设备上的待办同步释放。
// 已经释放（末态/非待办）的记录不再处理，重复确认断电也不会二次生效。
function releaseCrewTodos(deviceCode: string): number {
  const code = deviceCode.trim()
  if (!code) {
    return 0
  }
  const crewRows = listRows(CREW_KEY)
  let released = 0
  const nextCrew = crewRows.map((row) => {
    if (String(row['关联设备'] ?? '').trim() !== code) {
      return row
    }
    if (!row.pending || row.status === CREW_RELEASED_STATUS) {
      return row
    }
    released += 1
    return { ...row, status: CREW_RELEASED_STATUS, pending: false, 在岗状态: `已离岗·${code}断电后释放` }
  })
  if (released > 0) {
    saveRows(CREW_KEY, nextCrew)
  }
  return released
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
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

  // 地面电源确认断电：同步释放其它入口的地勤排班待办
  if (key === GROUND_POWER_KEY && action === '结束供电') {
    const released = releaseCrewTodos(String(updated['设备编号'] ?? ''))
    const syncNote = released > 0 ? `，已同步释放地勤排班待办 ${released} 条` : '，地勤排班无关联待办'
    return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」${syncNote}`, releasedTodos: released }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export type GroundPowerPatch = Partial<Record<(typeof CONTROLLED_FIELDS)[number], string>>

// 修改地面电源受控字段的唯一入口，权限护栏全部在这里兜底：
//  - 非归属维护组（其他单位/他楼维护组）：越权提交直接拦截，一个字段都不改
//  - 共享机位：所属机位信息只读，不允许改派
//  - 新机位必须是本航站楼管辖机位，不允许把设备挪到他楼
//  - 归属航站楼只能由历史回填写入，任何提交都不能改动
//  - 提交内容与现状完全一致：视为重复提交，只生效一次，不重复落库
export function updateGroundPower(id: number, patch: GroundPowerPatch, actor: Actor): ActionResult {
  const rows = listRows(GROUND_POWER_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的地面电源` }
  }
  const current = rows[index]

  if (actor.kind !== 'maintenance' || !isOwningActor(actor, current)) {
    const owner = `T${String(current[OWNED_TERMINAL_FIELD] ?? '').replace(/^T/, '')}航站楼维护组`
    return {
      ok: false,
      message: `越权提交已拦截：设备编号、所属机位、输出电压、额定电流仅${owner}可改动，${actor.unit}只有查看权限`,
    }
  }

  // 归属字段受系统管控，提交里即使携带也一律忽略（受控记录旧值不能借道改写）
  const candidate: EntryRow = { ...current }
  for (const field of CONTROLLED_FIELDS) {
    if (patch[field] !== undefined) {
      candidate[field] = String(patch[field] ?? '').trim()
    }
  }

  // 重复提交：四项受控值与现状完全一致，直接判定为重复，不生效
  const unchanged = CONTROLLED_FIELDS.every((field) =>
    String(candidate[field] ?? '') === String(current[field] ?? ''))
  if (unchanged) {
    return { ok: false, message: '提交内容与现有记录一致，重复提交只生效一次，未做改动' }
  }

  for (const field of CONTROLLED_FIELDS) {
    if (String(candidate[field] ?? '').trim() === '') {
      return { ok: false, message: `${field}不能为空` }
    }
  }

  const myTerminal = actorTerminal(actor)
  const nextStand = String(candidate['所属机位'])
  if (nextStand !== String(current['所属机位'])) {
    // 共享机位的机位信息保持只读：不允许从共享机位改派出去
    if (isSharedStand(String(current['所属机位']))) {
      return { ok: false, message: `机位 ${current['所属机位']} 是共享机位，机位信息保持只读，不能改派` }
    }
    const standTerminal = terminalOfStand(nextStand)
    if (!standTerminal) {
      return { ok: false, message: `机位 ${nextStand} 不在管辖范围内，不能把设备登记到无法识别归属的机位` }
    }
    if (standTerminal !== myTerminal) {
      return { ok: false, message: `越权提交已拦截：机位 ${nextStand} 属于${standTerminal}航站楼，本维护组只能在${myTerminal}机位范围内调整` }
    }
  }

  // 设备编号同模块内唯一
  const duplicated = rows.some(
    (row) => Number(row.id) !== Number(current.id) && String(row['设备编号']) === String(candidate['设备编号']),
  )
  if (duplicated) {
    return { ok: false, message: `设备编号 ${candidate['设备编号']} 已存在，不能重复登记` }
  }

  const next = [...rows]
  next[index] = candidate
  saveRows(GROUND_POWER_KEY, next)
  return { ok: true, message: `地面电源 ${candidate['设备编号']} 的受控信息已更新（归属航站楼保持 ${current[OWNED_TERMINAL_FIELD]} 不变）` }
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
