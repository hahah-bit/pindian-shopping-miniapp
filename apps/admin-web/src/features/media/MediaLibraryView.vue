<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { MediaAssetAdminView } from '@pindian/contracts';
import { ApiClientError, deleteMediaAsset, listMediaAssets, uploadMediaAsset } from '../../platform/api-client';

const items = ref<MediaAssetAdminView[]>([]);
const page = ref(1);
const pageSize = 12;
const total = ref(0);
const loading = ref(false);
const error = ref('');
const uploading = ref(false);
const uploadError = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

async function load(targetPage = page.value) {
  loading.value = true;
  error.value = '';
  try {
    const result = await listMediaAssets(targetPage, pageSize);
    items.value = result.items;
    total.value = result.total;
    page.value = targetPage;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取失败';
  } finally {
    loading.value = false;
  }
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  uploading.value = true;
  uploadError.value = '';
  try {
    for (const file of files) await uploadMediaAsset(file);
    await load(1);
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      const map: Record<string, string> = {
        PAYLOAD_TOO_LARGE: '文件超过 5 MiB 限制',
        UNSUPPORTED_MEDIA_TYPE: '仅支持 JPEG/PNG/WebP 且文件需可解码',
        VALIDATION_FAILED: cause.message,
        UNAUTHENTICATED: '登录已过期，请重新登录',
        STORAGE_UNAVAILABLE: '图片存储暂不可用，请稍后重试'
      };
      uploadError.value = map[cause.code] ?? `${cause.message}（${cause.code}）`;
    } else {
      uploadError.value = '上传失败，请重试';
    }
  } finally {
    uploading.value = false;
    input.value = '';
  }
}

const deletingId = ref('');

async function remove(asset: MediaAssetAdminView) {
  if (asset.referencedByProducts > 0 || deletingId.value) return;
  if (!window.confirm('确认删除这张未被引用的图片？删除后不可恢复。')) return;
  deletingId.value = asset.id;
  error.value = '';
  try {
    await deleteMediaAsset(asset.id);
    await load();
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? cause.message : '删除失败';
  } finally {
    deletingId.value = '';
  }
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize));

onMounted(() => load(1));
</script>

<template>
  <div class="toolbar">
    <div><h2>图片库</h2><p>商品图片资源与商品关联分开管理；仍被引用的图片不可删除。</p></div>
    <div class="controls">
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onFileChange" />
      <button type="button" :disabled="uploading" @click="fileInput?.click()">{{ uploading ? '正在上传…' : '上传图片' }}</button>
      <button type="button" :disabled="loading" @click="load()">刷新</button>
    </div>
  </div>
  <p v-if="uploadError" class="error" role="alert">{{ uploadError }}</p>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="loading && !items.length" role="status">正在读取图片库…</p>
  <div v-else-if="!items.length && !error" class="placeholder"><h2>暂无图片</h2><p>点击“上传图片”添加 JPEG/PNG/WebP，单张不超过 5 MiB。</p></div>
  <template v-else>
    <div class="media-grid">
      <figure v-for="asset in items" :key="asset.id" class="media-card">
        <img :src="asset.url" :alt="`图片 ${asset.id}`" loading="lazy" @error="($event.target as HTMLImageElement).classList.add('broken')" />
        <figcaption>
          <span>{{ asset.format.toUpperCase() }} · {{ asset.width }}×{{ asset.height }} · {{ (asset.sizeBytes / 1024).toFixed(0) }} KB</span>
          <span :class="['badge', asset.referencedByProducts > 0 ? 'warn' : '']">
            {{ asset.referencedByProducts > 0 ? `被 ${asset.referencedByProducts} 个商品引用` : '未引用' }}
          </span>
        </figcaption>
        <button type="button" class="danger" :disabled="asset.referencedByProducts > 0 || deletingId === asset.id" :title="asset.referencedByProducts > 0 ? '先在商品中移除该图片' : '删除'" @click="remove(asset)">
          {{ deletingId === asset.id ? '删除中…' : '删除' }}
        </button>
      </figure>
    </div>
    <div class="pager">
      <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ totalPages() }} 页 · 共 {{ total }} 张</span>
      <button type="button" :disabled="page >= totalPages() || loading" @click="load(page + 1)">下一页</button>
    </div>
  </template>
</template>
