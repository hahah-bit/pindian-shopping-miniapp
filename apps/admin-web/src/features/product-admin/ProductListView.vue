<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from '../../platform/router';
import type { AdminProductListItem } from '@pindian/contracts';
import { ApiClientError, formatFen, publishProduct, unpublishProduct, listAdminProducts } from '../../platform/api-client';

const router = useRouter();
const items = ref<AdminProductListItem[]>([]);
const page = ref(1);
const pageSize = 10;
const total = ref(0);
const statusFilter = ref('');
const keyword = ref('');
const loading = ref(false);
const error = ref('');
const busyId = ref('');
const notice = ref('');

const STATUS_LABEL: Record<string, string> = { draft: '草稿', on_shelf: '已上架', off_shelf: '已下架' };

async function load(targetPage = 1) {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await listAdminProducts({
      status: statusFilter.value || undefined,
      keyword: keyword.value.trim() || undefined,
      page: targetPage,
      pageSize
    });
    items.value = result.items;
    total.value = result.total;
    page.value = targetPage;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取失败';
  } finally {
    loading.value = false;
  }
}

async function toggleShelf(item: AdminProductListItem) {
  if (busyId.value) return;
  busyId.value = item.id;
  notice.value = '';
  error.value = '';
  try {
    if (item.status === 'on_shelf') {
      await unpublishProduct(item.id);
      notice.value = `「${item.name}」已下架`;
    } else {
      const updated = await publishProduct(item.id);
      notice.value = `「${item.name}」已上架（库存 ${updated.availableWholeItems} 件）`;
    }
    await load(page.value);
  } catch (cause) {
    if (cause instanceof ApiClientError && cause.details?.length) {
      error.value = `操作未完成：${cause.details.join('；')}`;
    } else {
      error.value = cause instanceof Error ? cause.message : '操作失败';
    }
  } finally {
    busyId.value = '';
  }
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize));
onMounted(() => load(1));
</script>

<template>
  <div class="toolbar">
    <div><h2>商品与库存</h2><p>上架需要：资料完整、已设置主图、整件库存大于 0。</p></div>
    <div class="controls">
      <select v-model="statusFilter" aria-label="状态筛选" @change="load(1)">
        <option value="">全部状态</option>
        <option value="draft">草稿</option>
        <option value="on_shelf">已上架</option>
        <option value="off_shelf">已下架</option>
      </select>
      <input v-model="keyword" placeholder="按名称搜索" aria-label="名称关键字" @keyup.enter="load(1)" />
      <button type="button" :disabled="loading" @click="load(1)">查询</button>
      <button type="button" class="primary" @click="router.push('/catalog/new')">新建商品</button>
    </div>
  </div>
  <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="loading && !items.length" role="status">正在读取商品…</p>
  <div v-else-if="!items.length && !error" class="placeholder"><h2>暂无商品</h2><p>点击“新建商品”创建第一个拼单商品。</p></div>
  <template v-else>
    <table class="data-table">
      <thead>
        <tr><th>主图</th><th>名称</th><th>原价</th><th>数量/单位</th><th>库存</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in items" :key="item.id">
          <td><img v-if="item.mainImageUrl" class="thumb" :src="item.mainImageUrl" alt="" loading="lazy" /><span v-else class="badge warn">无主图</span></td>
          <td class="name-cell">{{ item.name }}<small>{{ item.id }}</small></td>
          <td>¥{{ formatFen(item.originalPriceFen) }}</td>
          <td>{{ item.wholeQuantity }} {{ item.unit }}</td>
          <td>{{ item.availableWholeItems }} 件<span v-if="item.stockStatus === 'sold_out'" class="badge warn">已售罄</span></td>
          <td><span class="badge">{{ STATUS_LABEL[item.status] ?? item.status }}</span></td>
          <td class="actions">
            <button type="button" @click="router.push(`/catalog/${item.id}`)">编辑</button>
            <button v-if="item.status !== 'on_shelf'" type="button" class="primary" :disabled="busyId === item.id" @click="toggleShelf(item)">上架</button>
            <button v-else type="button" class="danger" :disabled="busyId === item.id" @click="toggleShelf(item)">下架</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="pager">
      <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ totalPages() }} 页 · 共 {{ total }} 件</span>
      <button type="button" :disabled="page >= totalPages() || loading" @click="load(page + 1)">下一页</button>
    </div>
  </template>
</template>
