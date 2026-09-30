<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { PlatformInfo } from '@pindian/contracts';
import { getPlatform } from '../../platform/api-client';
import { mockPlatform } from './mock';

const mode = ref<'api' | 'mock'>('api');
const info = ref<PlatformInfo | null>(null);
const loading = ref(false);
const error = ref('');
let sequence = 0;

async function load() {
  const current = ++sequence;
  loading.value = true;
  error.value = '';
  info.value = null;
  try {
    const result = mode.value === 'mock' ? mockPlatform : await getPlatform();
    if (current === sequence) info.value = result;
  } catch (cause) {
    if (current === sequence) error.value = cause instanceof Error ? cause.message : '读取失败';
  } finally { if (current === sequence) loading.value = false; }
}

onMounted(load);
</script>

<template>
  <div class="toolbar">
    <div><h2>框架概览</h2><p>独立前端 · 领域模块 · 六边形架构</p></div>
    <div class="controls">
      <label for="data-source">数据来源</label>
      <select id="data-source" v-model="mode" @change="load"><option value="api">真实框架 API</option><option value="mock">Mock 预览</option></select>
      <button type="button" :disabled="loading" @click="load">刷新</button>
    </div>
  </div>
  <div class="notice">T002 已落地：后台登录、图片上传、商品与库存管理、小程序商品展示。拼单交易、支付、履约和客服尚未实现。</div>
  <p v-if="loading" role="status">正在读取框架状态…</p>
  <div v-else-if="error" class="error" role="alert">{{ error }}。请检查 API 是否启动；也可以主动切换 Mock 预览。</div>
  <template v-else-if="info">
    <div class="summary-grid">
      <article class="summary"><span>当前阶段</span><strong>框架基础</strong><small>{{ mode === 'api' ? '来自真实后端' : 'Mock 数据，不代表后端状态' }}</small></article>
      <article class="summary"><span>后端</span><strong>{{ info.backend }}</strong><small>模块化单体</small></article>
      <article class="summary"><span>数据库</span><strong>{{ info.database }}</strong><small>连接健康请查看 ready 接口</small></article>
    </div>
    <h3>领域边界</h3>
    <div class="context-grid"><article v-for="context in info.contexts" :key="context.key" class="context-card"><div><h4>{{ context.name }}</h4><span class="badge" :class="{ warn: context.status === 'partial' }">{{ context.status === 'partial' ? '部分实现' : '已规划' }}</span></div><p>{{ context.description }}</p><code>{{ context.key }}</code></article></div>
  </template>
</template>
