import type { EntryRow } from './types'

// 地面电源护栏：受控字段、归属规则、历史回填、断电后的跨模块待办释放都收敛在这里。

export const GROUND_POWER_KEY = 'ground_power'
export const CREW_SCHEDULE_KEY = 'crew_schedule'

/** 受控字段：只有本航站楼维护组可以提交改动。 */
export const CONTROLLED_FIELDS = ['设备编号', '所属机位', '输出电压', '额定电流'] as const

/** 共享机位信息：归属机位由机位分配模块统一下发，任何单位（含维护组）都只能读。 */
export const SHARED_READONLY_FIELDS = ['所属机位'] as const

/** 编辑入口允许触碰的字段白名单，白名单外的键一律忽略，防止越权夹带。 */
export const EDITABLE_FIELDS = ['设备编号', '设备类型', '所属机位', '输出电压', '额定电流'] as const

export const EDITABLE_STATUSES = ['待机'] as const

// 机位编号前缀 → 管辖航站楼。历史缺归属的设备按所属机位前缀推断，推断不出来的落 T1。
const STAND_TERMINAL: Array<[RegExp, string]> = [
  [/^(STAN|S)[-]?2\d{2}/i, 'T2'],
  [/^(STAN|S)[-]?1\d{2}/i, 'T1'],
]

export function maintenanceUnitOf(terminal: string): string {
  return `${terminal}航站楼维护组`
}

/** 按机位号推断管辖航站楼；缺机位号或无法识别时，由 T1 兜底接管。 */
export function inferTerminal(row: EntryRow): string {
  const standCode = String(row['所属机位'] ?? '').trim()
  for (const [pattern, terminal] of STAND_TERMINAL) {
    if (pattern.test(standCode)) {
      return terminal
    }
  }
  return 'T1'
}

export function isMaintenanceGroup(unit: string, terminal: string | null): boolean {
  return terminal !== null && unit === maintenanceUnitOf(terminal)
}

/** 受控记录：只要离开过待机态（供过电/报修过），受控旧值就锁死，维护组也只能查看旧值。 */
export function isControlledRecord(row: EntryRow): boolean {
  return !EDITABLE_STATUSES.includes(String(row.status) as (typeof EDITABLE_STATUSES)[number])
}

/**
 * 历史设备归属回填：只在归属字段缺失时补，已有的字段（含旧值）一律不动。
 * 返回 true 表示本条发生了回填，便于审计登记。
 */
export function backfillOwnership(row: EntryRow): boolean {
  let changed = false
  if (String(row['归属航站楼'] ?? '').trim() === '') {
    row['归属航站楼'] = inferTerminal(row)
    changed = true
  }
  if (String(row['维护单位'] ?? '').trim() === '') {
    row['维护单位'] = maintenanceUnitOf(String(row['归属航站楼']))
    changed = true
  }
  if (String(row['归属来源'] ?? '').trim() === '') {
    row['归属来源'] = '历史回填'
    changed = true
  }
  return changed
}

/** 地勤排班历史记录缺关联设备时，按人员编号尾号与设备号配对（演示用既有数据的管辖回填）。 */
export function backfillCrewLink(row: EntryRow): boolean {
  if (String(row['关联设备'] ?? '').trim() !== '') {
    return false
  }
  const tail = Number(row.id) % 2 === 0 ? '0002' : '0001'
  row['关联设备'] = `GROU-${tail}`
  return true
}

export type ReleasedTodo = {
  crewId: number
  crewCode: string
  previousStatus: string
}

/**
 * 确认断电后，其它入口（地勤排班清单）里关联该设备的待办同步释放。
 * 只处理仍处于待办（pending）的记录，已释放/已处理的不动，天然防重复释放。
 */
export function releaseCrewTodos(
  crewRows: EntryRow[],
  deviceCode: string,
): { next: EntryRow[]; released: ReleasedTodo[] } {
  const released: ReleasedTodo[] = []
  const next = crewRows.map((row) => {
    const linked = String(row['关联设备'] ?? '').trim() === deviceCode.trim()
    if (!linked || !row.pending) {
      return row
    }
    released.push({
      crewId: Number(row.id),
      crewCode: String(row['人员编号']),
      previousStatus: String(row.status),
    })
    return { ...row, status: '已释放', pending: false }
  })
  return { next, released }
}
