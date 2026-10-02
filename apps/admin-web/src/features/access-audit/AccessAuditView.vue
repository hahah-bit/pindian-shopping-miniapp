<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminAuditLogItem, RolePermissionMatrix } from '@pindian/contracts';
import { getRoleMatrix, listAuditLogs, ApiClientError } from '../../platform/api-client';

const items = ref<AdminAuditLogItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const error = ref('');
const matrix = ref<RolePermissionMatrix | null>(null);

const filterAction = ref('');
const filterResourceType = ref('');
const filterAdminId = ref('');
const filterFrom = ref('');
const filterTo = ref('');
const expanded = ref<string | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await listAuditLogs({
      action: filterAction.value || undefined,
      resourceType: filterResourceType.value || undefined,
      adminId: filterAdminId.value || undefined,
      from: filterFrom.value || undefined,
      to: filterTo.value || undefined,
      page: page.value,
      pageSize
    });
    items.value = result.items;
    total.value = result.total;
  } catch (cause) {
    items.value = [];
    total.value = 0;
    error.value = cause instanceof ApiClientError ? cause.message : '无法连接后端';
  } finally {
    loading.value = false;
  }
}

async function loadMatrix(): Promise<void> {
  try {
    matrix.value = await getRoleMatrix();
  } catch (cause) {
    if (cause instanceof ApiClientError && cause.code === 'FORBIDDEN') return;
    matrix.value = null;
  }
}

function applyFilter(): void {
  page.value = 1;
  void load();
}

function formatTime(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
}

onMounted(() => {
  void load();
  void loadMatrix();
});
</script>

<template>
  <div>
    <div class="toolbar">
      <div>
        <h2>权限与审计</h2>
        <p>后台操作日志只读查询（手机号等敏感信息已脱敏）；角色权限矩阵为系统当前生效配置。</p>
      </div>
      <div class="controls">
        <button type="button" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p>

    <div class="form-card" style="margin-bottom: 18px">
      <div class="field-row">
        <label>动作前缀 <input v-model="filterAction" placeholder="如 fulfillment.ship" @keyup.enter="applyFilter" /></label>
        <label>资源类型 <input v-model="filterResourceType" placeholder="如 order" @keyup.enter="applyFilter" /></label>
        <label>管理员 ID <input v-model="filterAdminId" placeholder="UUID，可留空" @keyup.enter="applyFilter" /></label>
        <label>开始日期 <input v-model="filterFrom" type="date" @change="applyFilter" /></label>
        <label>结束日期 <input v-model="filterTo" type="date" @change="applyFilter" /></label>
        <button type="button" class="primary" :disabled="loading" @click="applyFilter">查询</button>
      </div>
    </div>

    <p v-if="!error && !loading && !items.length" class="hint">暂无符合条件的操作日志</p>
    <table v-else class="data-table">
      <thead>
        <tr><th>时间</th><th>管理员</th><th>动作</th><th>资源</th><th>详情</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ formatTime(item.createdAt) }}</td>
          <td>{{ item.adminDisplayName ?? '（已删除）' }}</td>
          <td><span class="badge">{{ item.action }}</span></td>
          <td class="name-cell">{{ item.resourceType }}<small v-if="item.resourceId">{{ item.resourceId.slice(0, 8) }}</small></td>
          <td>
            <a href="javascript:void(0)" @click="expanded = expanded === item.id ? null : item.id">{{ expanded === item.id ? '收起' : '展开' }}</a>
            <code v-if="expanded === item.id" style="display:block; margin-top:6px; white-space:pre-wrap">{{ JSON.stringify(item.detail, null, 2) }}</code>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="pager">
      <button type="button" :disabled="page <= 1 || loading" @click="page--; load()">上一页</button>
      <span>第 {{ page }} 页 / 共 {{ Math.max(1, Math.ceil(total / pageSize)) }} 页（{{ total }} 条）</span>
      <button type="button" :disabled="page * pageSize >= total || loading" @click="page++; load()">下一页</button>
    </div>

    <template v-if="matrix">
      <h3>角色权限矩阵</h3>
      <table class="data-table">
        <thead><tr><th>角色</th><th>权限码</th></tr></thead>
        <tbody>
          <tr v-for="role in matrix.roles" :key="role.role">
            <td class="name-cell">{{ role.label }}<small>{{ role.role }}</small></td>
            <td><span v-for="p in role.permissions" :key="p" class="badge" style="margin-right:6px">{{ p }}</span></td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
