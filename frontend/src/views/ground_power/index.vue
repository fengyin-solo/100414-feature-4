<template>
  <section class="page" data-module="ground_power">
    <header class="page-head">
      <div>
        <h2>地面电源管理</h2>
        <p class="page-desc">设备编号、所属机位、输出电压、额定电流为受控信息，仅本航站楼维护组可改；共享机位信息只读，受控记录旧值锁死。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地面电源</button>
        <button class="btn" type="button" @click="exportRows">导出地面电源清单</button>
      </div>
    </header>

    <p class="guard-banner" :class="identity.kind === 'maintenance' ? 'guard-owner' : 'guard-readonly'">
      <template v-if="identity.kind === 'maintenance'">
        当前值班单位：{{ identity.unit }}。仅归属 {{ identity.terminal }} 航站楼的设备可由本组改动；其它航站楼设备与共享机位信息只读。
      </template>
      <template v-else>
        当前值班单位：{{ identity.unit }}（非航站楼维护组）。地面电源受控信息对本单位只读，越权提交会被服务层直接拦截。
      </template>
    </p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="isControlled(row)" class="lock-tag" title="已离开待机态，受控旧值已锁死">🔒 受控</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="!canEditRow(row)"
              :title="canEditRow(row) ? action : '仅本航站楼维护组可执行该操作'"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <button class="link" type="button" @click="openRecord(row)">档案</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无地面电源数据，可先登记地面电源</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条地面电源记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <div v-if="dialog.open" class="modal-mask" @click.self="closeDialog">
      <div class="modal">
        <header class="modal-head">
          <h3>{{ dialog.mode === 'create' ? '登记地面电源' : `地面电源档案 · ${String(dialog.row?.['设备编号'] ?? '')}` }}</h3>
          <button class="link" type="button" @click="closeDialog">关闭</button>
        </header>

        <p v-if="!dialog.canEdit" class="guard-banner guard-readonly">
          {{ identity.unit }}对该设备只有查看权限；受控字段与共享机位信息不可改动。
        </p>
        <p v-else-if="dialog.mode === 'edit' && isControlled(dialog.row!)" class="guard-banner guard-locked">
          该设备已进入「{{ dialog.row?.status }}」受控状态，设备编号、输出电压、额定电流等旧值已锁死，仅可查看档案与审计轨迹。
        </p>

        <div class="form-grid">
          <label v-for="field in formFields" :key="field" class="form-item">
            <span>
              {{ field }}
              <em v-if="isControlledField(field)" class="required-mark">受控</em>
              <em v-if="isSharedField(field)" class="shared-mark">共享只读</em>
            </span>
            <input
              v-model="dialog.form[field]"
              :disabled="!fieldEditable(field)"
              :placeholder="`请输入${field}`"
            />
          </label>
          <label v-if="dialog.mode !== 'create'" class="form-item">
            <span>归属航站楼</span>
            <input :value="String(dialog.row?.['归属航站楼'] ?? '—')" disabled />
          </label>
          <label v-if="dialog.mode !== 'create'" class="form-item">
            <span>维护单位</span>
            <input :value="String(dialog.row?.['维护单位'] ?? '—')" disabled />
          </label>
          <label v-if="dialog.mode !== 'create'" class="form-item">
            <span>归属来源</span>
            <input :value="String(dialog.row?.['归属来源'] ?? '—')" disabled />
          </label>
        </div>

        <section class="trail-block">
          <h4>受控审计轨迹（只追加，旧值不可改）</h4>
          <ul v-if="dialog.trail.length" class="trail-list">
            <li v-for="(item, index) in dialog.trail" :key="index" :class="item.ok ? 'trail-ok' : 'trail-denied'">
              <span class="trail-time">{{ item.time }}</span>
              <span class="trail-text">{{ item.action }} · {{ item.operator }}（{{ item.unit }}）：{{ item.message }}</span>
              <ul v-if="item.changes?.length" class="trail-changes">
                <li v-for="change in item.changes" :key="change.field">
                  {{ change.field }}：「{{ change.old }}」→「{{ change.next }}」
                </li>
              </ul>
            </li>
          </ul>
          <p v-else class="trail-empty">暂无受控操作记录</p>
        </section>

        <footer class="modal-foot">
          <button class="btn ghost" type="button" @click="closeDialog">取消</button>
          <button v-if="dialog.canEdit" class="btn primary" type="button" :disabled="submitting" @click="submitDialog">
            {{ submitting ? '提交中…' : dialog.mode === 'create' ? '提交登记' : '保存受控信息' }}
          </button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createGroundPower,
  downloadEntries,
  listEntries,
  moduleMeta,
  recordTrail,
  runAction as applyAction,
  updateGroundPower,
} from '@/api/local-service'
import { isControlledRecord } from '@/data/governance'
import { useSessionStore } from '@/stores/session'
import type { AuditEntry, EntryRow } from '@/data/types'

const store = useSessionStore()
const identity = computed(() => store.identity)

const meta = moduleMeta('ground_power')
const columns = ["设备编号", "设备类型", "所属机位", "输出电压", "额定电流", "归属航站楼", "维护单位", "归属来源"]
const formFields = ["设备编号", "设备类型", "所属机位", "输出电压", "额定电流"]
const controlledFieldSet = new Set(["设备编号", "所属机位", "输出电压", "额定电流"])
const sharedFieldSet = new Set(["所属机位"])
const actions = ["开始供电", "结束供电", "停用报修"]
const statuses = ["待机", "供电中", "已断电", "故障停用"]
const stats = [{ label: "供电中设备", value: 0 }, { label: "待机设备", value: 0 }, { label: "故障设备", value: 0 }]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const submitting = ref(false)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

type DialogState = {
  open: boolean
  mode: 'create' | 'edit' | 'view'
  canEdit: boolean
  row: EntryRow | null
  form: Record<string, string>
  trail: AuditEntry[]
  requestId: string
}

const dialog = reactive<DialogState>({
  open: false,
  mode: 'view',
  canEdit: false,
  row: null,
  form: {},
  trail: [],
  requestId: '',
})

function newRequestId(): string {
  return `gp-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function isControlled(row: EntryRow | null | undefined): boolean {
  return !!row && isControlledRecord(row)
}

function isControlledField(field: string): boolean {
  return controlledFieldSet.has(field)
}

function isSharedField(field: string): boolean {
  return sharedFieldSet.has(field)
}

function ownsRow(row: EntryRow): boolean {
  return identity.value.kind === 'maintenance'
    && identity.value.terminal === String(row['归属航站楼'] ?? '')
}

function canEditRow(row: EntryRow): boolean {
  return ownsRow(row)
}

function fieldEditable(field: string): boolean {
  if (!dialog.canEdit) {
    return false
  }
  // 共享机位信息始终只读。
  if (isSharedField(field)) {
    return false
  }
  // 受控记录（供过电/报修）的受控旧值锁死。
  if (dialog.mode === 'edit' && isControlled(dialog.row) && isControlledField(field)) {
    return false
  }
  return true
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  if (identity.value.kind !== 'maintenance' || identity.value.terminal === null) {
    // UI 不给表单，服务层同样拦截：双保险。
    errorMessage.value = `越权拦截：地面电源登记仅航站楼维护组可操作，${identity.value.unit}只有查看权限`
    successMessage.value = ''
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  Object.assign(dialog, {
    open: true,
    mode: 'create',
    canEdit: true,
    row: null,
    form: {
      '设备编号': '',
      '设备类型': '',
      '所属机位': '',
      '输出电压': '',
      '额定电流': '',
    },
    trail: [],
    requestId: newRequestId(),
  })
}

function openRecord(row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const owner = ownsRow(row)
  Object.assign(dialog, {
    open: true,
    mode: owner ? 'edit' : 'view',
    canEdit: owner,
    row,
    form: {
      '设备编号': String(row['设备编号'] ?? ''),
      '设备类型': String(row['设备类型'] ?? ''),
      '所属机位': String(row['所属机位'] ?? ''),
      '输出电压': String(row['输出电压'] ?? ''),
      '额定电流': String(row['额定电流'] ?? ''),
    },
    trail: recordTrail(meta.key, Number(row.id)),
    requestId: newRequestId(),
  })
}

function closeDialog() {
  dialog.open = false
  dialog.row = null
  dialog.trail = []
}

function submitDialog() {
  if (submitting.value) {
    return
  }
  submitting.value = true
  try {
    const result = dialog.mode === 'create'
      ? createGroundPower(dialog.form, identity.value, dialog.requestId)
      : updateGroundPower(Number(dialog.row?.id), dialog.form, identity.value, dialog.requestId)
    if (!result.ok) {
      errorMessage.value = result.message
      successMessage.value = ''
      // 被拦截的提交也会留在审计轨迹里，刷新弹窗可见。
      if (dialog.mode !== 'create') {
        dialog.trail = recordTrail(meta.key, Number(dialog.row?.id))
      }
      return
    }
    successMessage.value = result.message
    errorMessage.value = ''
    closeDialog()
    reload()
  } finally {
    submitting.value = false
  }
}

function runAction(action: string, row: EntryRow) {
  if (!canEditRow(row)) {
    errorMessage.value = `越权拦截：该设备归属${String(row['维护单位'] ?? '对应航站楼维护组')}，${identity.value.unit}无权执行「${action}」`
    successMessage.value = ''
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  // 每次动作意图一个 requestId：连点时服务层的状态守卫 + 幂等登记共同保证只生效一次。
  const result = applyAction(meta.key, Number(row.id), action, identity.value, newRequestId())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '地面电源列表读取失败'
  }
}

onMounted(reload)
</script>
