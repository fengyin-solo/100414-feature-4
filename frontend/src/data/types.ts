/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

/** 操作者身份：kind 为航站楼维护组时 terminal 非空，其它单位只有查看权限。 */
export type IdentityKind = 'maintenance' | 'other'

export type Identity = {
  operator: string
  unit: string
  terminal: string | null
  kind: IdentityKind
}

export type AuditChange = {
  field: string
  old: string | number | boolean
  next: string | number | boolean
}

/** 只追加的受控档案审计记录：旧值快照落在这里，任何入口都不能修改或删除。 */
export type AuditEntry = {
  time: string
  module: string
  recordId: number | null
  action: string
  operator: string
  unit: string
  ok: boolean
  message: string
  changes?: AuditChange[]
  requestId?: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
