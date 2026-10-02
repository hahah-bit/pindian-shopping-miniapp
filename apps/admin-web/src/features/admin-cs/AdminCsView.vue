<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { ApiClientError, acceptCsConversation, listCsQueue, listCsConversations } from '../../platform/api-client';

/** 客服工作台（T008 F032）：排队/我的会话、接入（并发恰一人）、2s 轮询刷新。 */

const tab = ref<'queue' | 'mine'>('queue');
const items = ref<Array<{ id: string; status: string; hasAgent: boolean }>>([]);
const loading = ref(false);
const error = ref('');
const notice = ref('');
let pollTimer: number | null = null;

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const result = tab.value === 'queue' ? await listCsQueue() : await listCsConversations('active');
    items.value = (result as { items: Array<{ id: string; status: string; hasAgent: boolean }> }).items;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${(cause as ApiClientError).code}）` : '读取失败';
  } finally {
    loading.value = false;
  }
}

function switchTab(next: 'queue' | 'mine') {
  tab.value = next;
  void load();
}

async function accept(id: string) {
  error.value = '';
  notice.value = '';
  try {
    await acceptCsConversation(id);
    notice.value = '已接入，可在会话中回复';
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${(cause as ApiClientError).code}）` : '接入失败';
    await load();
  }
}

onMounted(() => {
  void load();
  pollTimer = window.setInterval(() => void load(), 4000);
});
onBeforeUnmount(() => {
  if (pollTimer !== null) window.clearInterval(pollTimer);
});
</script>

<template>
  <div class="toolbar">
    <div><h2>客服工作台</h2><p>排队接入与我的会话（4s 自动刷新）；转工单/备注/退款等操作见下方会话处理。</p></div>
    <div class="controls">
      <button type="button" :class="{ primary: tab === 'queue' }" @click="switchTab('queue')">排队中</button>
      <button type="button" :class="{ primary: tab === 'mine' }" @click="switchTab('mine')">我的会话</button>
    </div>
  </div>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="notice" class="hint" role="status">{{ notice }}</p>
  <p v-if="loading" role="status">正在读取…</p>

  <table v-if="items.length" class="data-table">
    <thead><tr><th>会话 ID</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="conversation in items" :key="conversation.id">
        <td class="name-cell">{{ conversation.id }}</td>
        <td><span class="badge">{{ conversation.status === 'queued' ? '排队中' : '接待中' }}</span></td>
        <td class="actions">
          <button v-if="conversation.status === 'queued'" type="button" @click="accept(conversation.id)">接入</button>
        </td>
      </tr>
    </tbody>
  </table>
  <div v-if="!items.length && !loading && !error" class="placeholder"><h2>暂无会话</h2></div>
</template>
