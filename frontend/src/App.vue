<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">机场地面保障调度管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向航班机位分配、廊桥调度、行李转运、货物装卸、航空加油、航食配餐与客舱清洁全流程的机场地面保障调度管理平台。</span>
        <span class="head-user">
          <label class="actor-switch">
            当前值班单位
            <select :value="store.actor.id" @change="switchActor">
              <option v-for="actor in actors" :key="actor.id" :value="actor.id">
                {{ actor.unit }} · {{ actor.label }}
              </option>
            </select>
          </label>
          <span>{{ store.actor.label }} · {{ store.shiftLabel }}</span>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ACTORS, useSessionStore } from '@/stores/session'

const store = useSessionStore()
const actors = ACTORS

function switchActor(event: Event) {
  const id = (event.target as HTMLSelectElement).value
  const actor = actors.find((item) => item.id === id)
  if (actor) {
    store.setActor(actor)
  }
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "机位分配", path: "/stand" }, { label: "廊桥调度", path: "/bridge" }, { label: "地面电源", path: "/ground_power" }, { label: "行李转运", path: "/baggage" }, { label: "货物装卸", path: "/cargo" }, { label: "航空加油", path: "/fueling" }, { label: "航食配餐", path: "/catering" }, { label: "客舱清洁", path: "/cabin_clean" }, { label: "排污服务", path: "/lavatory" }, { label: "除冰作业", path: "/deicing" }, { label: "牵引车调度", path: "/pushback" }, { label: "地勤排班", path: "/crew_schedule" }, { label: "特种车辆", path: "/special_vehicle" }, { label: "航班保障", path: "/flight_ops" }, { label: "过站监控", path: "/turnaround" }, { label: "机坪安全", path: "/apron_safety" }, { label: "装卸设备", path: "/load_equip" }, { label: "应急保障", path: "/air_emergency" }]
</script>

<style scoped>
.actor-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.actor-switch select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  background: #fff;
}
</style>
