import type { Actor } from '@/stores/session'
import type { EntryRow } from '@/data/types'

// 地面电源的权限与归属护栏：
// 设备编号、所属机位、输出电压、额定电流四项受控字段，只允许「本航站楼维护组」改动；
// 其他单位（地勤班组、加油/航食等外协单位）只能查看，越权提交一律拦截。
// 归属航站楼是设备的管辖归属，只在历史回填时写入，任何编辑提交都不能改动它。
// 共享机位（远站/多楼共用机位）的机位信息保持只读，归属按兜底规则落到对应维护组。

export const GROUND_POWER_KEY = 'ground_power'
export const STAND_KEY = 'stand'
export const CREW_KEY = 'crew_schedule'

export const OWNED_TERMINAL_FIELD = '归属航站楼'

// 受控字段：只有设备归属航站楼的维护组能改
export const CONTROLLED_FIELDS = ['设备编号', '所属机位', '输出电压', '额定电流'] as const

export const TERMINALS = ['T1', 'T2', 'T3'] as const
export type Terminal = (typeof TERMINALS)[number]

// 各航站楼维护组的身份 id，与 stores/session 里的 ACTORS 对应
export const MAINTENANCE_ACTORS: Record<Terminal, string> = {
  T1: 'maintenance-t1',
  T2: 'maintenance-t2',
  T3: 'maintenance-t3',
}

// 机位前缀 -> 所属航站楼：机位编号以楼号前缀开头（T1-xxx / T2-xxx / T3-xxx）
const STAND_PREFIX: Record<Terminal, string> = { T1: 'T1', T2: 'T2', T3: 'T3' }

// 共享机位：远站多楼共用机位，机位信息（含设备的「所属机位」字段）保持只读
const SHARED_STAND_PREFIX = 'TS'

export function terminalOfStand(standCode: string): Terminal | null {
  const code = String(standCode ?? '').trim().toUpperCase()
  for (const terminal of TERMINALS) {
    if (code.startsWith(`${STAND_PREFIX[terminal]}-`) || code === STAND_PREFIX[terminal]) {
      return terminal
    }
  }
  return null
}

export function isSharedStand(standCode: string): boolean {
  const code = String(standCode ?? '').trim().toUpperCase()
  return code.startsWith(`${SHARED_STAND_PREFIX}-`) || code === SHARED_STAND_PREFIX
}

// 本维护组是否为该设备的归属维护组
export function isOwningActor(actor: Actor, row: EntryRow): boolean {
  if (actor.kind !== 'maintenance') {
    return false
  }
  return MAINTENANCE_ACTORS[row[OWNED_TERMINAL_FIELD] as Terminal] === actor.id
}

export function actorTerminal(actor: Actor): Terminal | null {
  const entry = Object.entries(MAINTENANCE_ACTORS).find(([, id]) => id === actor.id)
  return (entry?.[0] as Terminal | undefined) ?? null
}

// 缺归属的历史设备按管辖范围回填：
// 1) 所属机位带本楼前缀的，归该楼维护组；
// 2) 共享机位/无法辨认前缀的，按设备编号稳定轮派到 T1/T2/T3（本航站楼维护组兜底接管）。
// 只回填「归属航站楼」这一个字段，已有的受控字段旧值一律不动。
export function inferTerminal(row: EntryRow): Terminal {
  const standCode = String(row['所属机位'] ?? '')
  const fromStand = terminalOfStand(standCode)
  if (fromStand) {
    return fromStand
  }
  const numericId = Number(row.id)
  const index = Number.isFinite(numericId) && numericId > 0 ? numericId - 1 : 0
  return TERMINALS[index % TERMINALS.length]
}

// 给缺归属的历史设备回填归属航站楼；返回是否发生过回填
export function backfillOwnership(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  let changed = false
  const next = rows.map((row) => {
    if (String(row[OWNED_TERMINAL_FIELD] ?? '').trim() !== '') {
      return row
    }
    changed = true
    return { ...row, [OWNED_TERMINAL_FIELD]: inferTerminal(row) }
  })
  return { rows: next, changed }
}
