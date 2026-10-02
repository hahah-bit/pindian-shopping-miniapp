<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminDeliveryListItem } from '@pindian/contracts';
import { listNotificationDeliveries, retryNotificationDelivery, ApiClientError } from '../../platform/api-client';

const items = ref<AdminDeliveryListItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 10;
const loading = ref(false);
const error = ref('');
const notice = ref('');
const retryingId = ref<string | null>(null);

const filterStatus = ref('');
const filterEventType = ref('');

const statusLabels: Record<string, string> = { pending: '待投递', sent: '已发送', skipped: '已跳过', failed: '失败' };

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const result = await listNotificationDeliveries({
      status: filterStatus.value || undefined,
      eventType: filterEventType.value || undefined,
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

function applyFilter(): void {
  page.value = 1;
  void load();
}

async function retry(item: AdminDeliveryListItem): Promise<void> {
  if (retryingId.value) return;
  if (!window.confirm(`确认重试该投递？事件：${item.eventType}`)) return;
  retryingId.value = item.id;
  error.value = '';
  notice.value = '';
  try {
    await retryNotificationDelivery(item.id);
    notice.value = '已重置为待投递，投递驱动任务将再次尝试';
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : '重试失败';
  } finally {
    retryingId.value = null;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().replace('T', ' ').slice(5, 16);
}

onMounted(load);
</script>

<template>
  <div>
    <div class="toolbar">
      <div>
        <h2>通知投递</h2>
        <p>通知投递记录与失败查询；未配置外发渠道时以「已跳过（channel_not_configured）」留痕，仅失败记录可手工重试。</p>
      </div>
      <div class="controls">
        <select v-model="filterStatus" @change="applyFilter">
          <option value="">全部状态</option>
          <option value="pending">待投递</option>
          <option value="sent">已发送</option>
          <option value="skipped">已跳过</option>
          <option value="failed">失败</option>
        </select>
        <input v-model="filterEventType" placeholder="事件类型前缀，如 refund" style="width: 180px" @keyup.enter="applyFilter" />
        <button type="button" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
      </div>
    </div>

    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="error" class="error" role="alert">{{ error }} <button type="button" @click="load">重试</button></p>

    <p v-if="!error && !loading && !items.length" class="hint">暂无投递记录（通知创建后由 Worker 驱动投递）</p>
    <table v-else class="data-table">
      <thead>
        <tr><th>时间</th><th>事件</th><th>接收者</th><th>渠道</th><th>状态</th><th>尝试</th><th>下次重试 / 发送</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td>{{ formatTime(item.createdAt) }}</td>
          <td class="name-cell"><span class="badge">{{ item.eventType }}</span><small>{{ item.title }}</small></td>
          <td>{{ item.recipientType === 'admin' ? '管理员' : '用户' }} · {{ item.recipientName }}</td>
          <td>{{ item.channel }}</td>
          <td>
            <span class="badge" :class="{ warn: item.status === 'failed' }">{{ statusLabels[item.status] ?? item.status }}</span>
            <small v-if="item.skippedReason" style="display:block">{{ item.skippedReason }}</small>
            <small v-else-if="item.lastError" style="display:block">{{ item.lastError }}</small>
          </td>
          <td>{{ item.attemptCount }}/{{ item.maxAttempts }}</td>
          <td>{{ formatTime(item.sentAt ?? item.nextAttemptAt) }}</td>
          <td class="actions">
            <button
              type="button"
              :disabled="item.status !== 'failed' || retryingId === item.id"
              :title="item.status === 'failed' ? '重置为待投递' : '仅失败投递可重试'"
              @click="retry(item)"
            >{{ retryingId === item.id ? '重试中…' : '重试' }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="pager">
      <button type="button" :disabled="page <= 1 || loading" @click="page--; load()">上一页</button>
      <span>第 {{ page }} 页 / 共 {{ Math.max(1, Math.ceil(total / pageSize)) }} 页（{{ total }} 条）</span>
      <button type="button" :disabled="page * pageSize >= total || loading" @click="page++; load()">下一页</button>
    </div>
  </div>
</template>
