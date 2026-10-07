import { defineStore } from 'pinia'

// 操作人身份：航站楼维护组可以改动本楼地面电源的受控字段；其他单位只能查看。
export type Actor = {
  id: string
  label: string
  unit: string
  kind: 'maintenance' | 'viewer'
}

// 可切换的值班身份（纯前端演示用，真实系统里来自登录态/鉴权）
export const ACTORS: Actor[] = [
  { id: 'maintenance-t1', label: '王维保', unit: 'T1航站楼维护组', kind: 'maintenance' },
  { id: 'maintenance-t2', label: '李维保', unit: 'T2航站楼维护组', kind: 'maintenance' },
  { id: 'maintenance-t3', label: '赵维保', unit: 'T3航站楼维护组', kind: 'maintenance' },
  { id: 'ground-crew', label: '孙地勤', unit: '地勤服务一队（其他单位）', kind: 'viewer' },
  { id: 'fuel-crew', label: '周加油', unit: '航空加油分队（其他单位）', kind: 'viewer' },
]

export const DEFAULT_ACTOR = ACTORS[0]

export const useSessionStore = defineStore('session', {
  state: () => ({
    actor: { ...DEFAULT_ACTOR } as Actor,
    shiftLabel: '白班 08:00-20:00',
    scope: '机场地面保障调度管理系统',
  }),
  getters: {
    operator: (state) => state.actor.label,
    canOperate: (state) => state.actor.label.length > 0,
  },
  actions: {
    setActor(actor: Actor) {
      this.actor = { ...actor }
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
