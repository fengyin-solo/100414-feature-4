<template>
  <section class="page" data-module="ground_power">
    <header class="page-head">
      <div>
        <h2>地面电源管理</h2>
        <p class="page-desc">设备编号、所属机位、输出电压、额定电流仅本航站楼维护组可改动，其他单位只读；共享机位信息保持只读。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记地面电源</button>
        <button class="btn" type="button" @click="exportRows">导出地面电源清单</button>
      </div>
    </header>

    <p class="guard-banner" :class="allReadOnly ? 'guard-readonly' : 'guard-edit'">
      当前身份：<strong>{{ session.actor.unit }}</strong>（{{ session.actor.label }}）
      <template v-if="allReadOnly">—— 非航站楼维护组，地面电源受控字段仅可查看，越权提交会被直接拦截。</template>
      <template v-else>—— 可改动归属 {{ editableTerminal }} 航站楼设备的受控字段；他楼设备与共享机位只读。</template>
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
          <th>资料</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              :disabled="busyId === String(row.id)"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
          <td class="row-actions">
            <button class="link" type="button" @click="openEdit(row)">
              {{ canManage(row) ? '编辑受控字段' : '查看' }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无地面电源数据，可先登记地面电源</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条地面电源记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <div v-if="editing" class="modal-mask" @click.self="closeEdit">
      <div class="modal-card">
        <h3>地面电源受控资料 · {{ form['设备编号'] }}</h3>
        <p class="modal-sub">
          归属航站楼：<strong>{{ editing['归属航站楼'] }}</strong>
          <span v-if="!canManage(editing)" class="error-text">（{{ session.actor.unit }} 仅有查看权限，提交会被拦截）</span>
        </p>
        <form class="modal-form" @submit.prevent="submitEdit">
          <label v-for="field in controlledColumns" :key="field" class="modal-field">
            <span>{{ field }}</span>
            <input
              v-model="form[field]"
              :disabled="!canManage(editing) || (field === '所属机位' && sharedStand)"
            />
            <em v-if="field === '所属机位' && sharedStand" class="field-hint">共享机位信息保持只读，不能改派</em>
          </label>
          <p v-if="editError" class="error-text">{{ editError }}</p>
          <div class="modal-actions">
            <button class="btn ghost" type="button" @click="closeEdit">取消</button>
            <button
              class="btn primary"
              type="submit"
              :disabled="!canManage(editing) || submitting"
            >
              {{ submitting ? '提交中…' : '提交' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  updateGroundPower,
} from '@/api/local-service'
import {
  CONTROLLED_FIELDS,
  isOwningActor,
  isSharedStand,
  actorTerminal,
} from '@/data/ground-power-policy'
import type { GroundPowerPatch } from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const session = useSessionStore()
const meta = moduleMeta('ground_power')
const columns = ["设备编号", "设备类型", "所属机位", "归属航站楼", "输出电压", "额定电流", "供电开始", "供电结束", "设备状态"]
const controlledColumns = [...CONTROLLED_FIELDS]
const actions = ["开始供电", "结束供电", "停用报修"]
const statuses = ["待机", "供电中", "已断电", "故障停用"]
const stats = [{"label": "供电中设备", "value": 0}, {"label": "待机设备", "value": 0}, {"label": "故障设备", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const busyId = ref('')

const editing = ref<EntryRow | null>(null)
const submitting = ref(false)
const editError = ref('')
const form = reactive<Record<string, string>>({
  设备编号: '',
  所属机位: '',
  输出电压: '',
  额定电流: '',
})

const allReadOnly = computed(() => session.actor.kind !== 'maintenance')
const editableTerminal = computed(() => actorTerminal(session.actor) ?? '—')
const sharedStand = computed(() =>
  editing.value ? isSharedStand(String(editing.value['所属机位'] ?? '')) : false)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function canManage(row: EntryRow): boolean {
  return isOwningActor(session.actor, row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '地面电源登记入口尚未接入审批流'
}

function openEdit(row: EntryRow) {
  editing.value = row
  editError.value = ''
  for (const field of controlledColumns) {
    form[field] = String(row[field] ?? '')
  }
}

function closeEdit() {
  if (submitting.value) {
    return
  }
  editing.value = null
  editError.value = ''
}

// 受控字段修改：权限/重复提交/共享机位只读全部由 local-service 兜底，页面只负责展示结果
function submitEdit() {
  if (!editing.value || submitting.value) {
    return
  }
  submitting.value = true
  editError.value = ''
  try {
    const patch: GroundPowerPatch = {
      设备编号: form['设备编号'],
      所属机位: form['所属机位'],
      输出电压: form['输出电压'],
      额定电流: form['额定电流'],
    }
    const result = updateGroundPower(Number(editing.value.id), patch, session.actor)
    if (!result.ok) {
      editError.value = result.message
      return
    }
    editing.value = null
    successMessage.value = result.message
    reload()
  } finally {
    submitting.value = false
  }
}

function runAction(action: string, row: EntryRow) {
  // 防重复提交：同一设备动作未返回前，按钮保持禁用
  if (busyId.value === String(row.id)) {
    return
  }
  errorMessage.value = ''
  successMessage.value = ''
  busyId.value = String(row.id)
  try {
    const result = applyAction(meta.key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    successMessage.value = result.message
    reload()
  } finally {
    busyId.value = ''
  }
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

<style scoped>
.guard-banner {
  margin: 8px 0 12px;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
}
.guard-readonly {
  background: #fef3f2;
  border: 1px solid #fecdca;
  color: #b42318;
}
.guard-edit {
  background: #ecfdf3;
  border: 1px solid #abefc6;
  color: #067647;
}
.success-text {
  color: #067647;
}
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.modal-card {
  width: 460px;
  background: #fff;
  border-radius: 10px;
  padding: 20px 22px;
  box-shadow: 0 18px 48px rgba(15, 23, 42, 0.25);
}
.modal-card h3 {
  margin: 0 0 6px;
}
.modal-sub {
  margin: 0 0 14px;
  color: #475467;
  font-size: 13px;
}
.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}
.modal-field input {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 10px;
}
.modal-field input:disabled {
  background: #f2f4f7;
  color: #667085;
}
.field-hint {
  color: #b54708;
  font-size: 12px;
  font-style: normal;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.link:disabled {
  color: #98a2b3;
  cursor: not-allowed;
}
</style>
