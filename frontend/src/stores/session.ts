import { defineStore } from 'pinia'

import type { Identity } from '@/data/types'

// 可切换的值班身份：地面电源的受控字段只对本航站楼维护组放行，其它单位仅查看。
export const IDENTITY_PRESETS: Identity[] = [
  { operator: '王维保', unit: 'T1航站楼维护组', terminal: 'T1', kind: 'maintenance' },
  { operator: '李维保', unit: 'T2航站楼维护组', terminal: 'T2', kind: 'maintenance' },
  { operator: '赵地勤', unit: '地勤服务大队', terminal: null, kind: 'other' },
  { operator: '周监查', unit: '运行指挥中心', terminal: null, kind: 'other' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    presetIndex: 0,
    shiftLabel: '白班 08:00-20:00',
  }),
  getters: {
    identity(state): Identity {
      return IDENTITY_PRESETS[state.presetIndex] ?? IDENTITY_PRESETS[0]
    },
    operator(): string {
      return this.identity.operator
    },
    canOperate(): boolean {
      return this.identity.operator.length > 0
    },
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    useIdentity(index: number) {
      if (index >= 0 && index < IDENTITY_PRESETS.length) {
        this.presetIndex = index
      }
    },
  },
})
