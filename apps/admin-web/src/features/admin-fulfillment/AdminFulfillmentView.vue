<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminFulfillmentDetail, AdminFulfillmentGroupSummary } from '@pindian/contracts';
import { ApiClientError, exportShipmentsCsv, getFulfillmentGroup, listFulfillmentGroups, shipFulfillmentOrder } from '../../platform/api-client';
import { storedToken } from '../../platform/api-client';

/** 履约管理（T007 F028）：待履约组、分配明细、发货/补发、导出发货单。发货数量以整数克填写。 */

const tab = ref<'groups' | 'detail'>('groups');
const items = ref<AdminFulfillmentGroupSummary[]>([]);
const detail = ref<AdminFulfillmentDetail[]>([]);
const detailGroupId = ref('');
const page = ref(1);
const total = ref(0);
const statusFilter = ref('');
const loading = ref(false);
const error = ref('');
const notice = ref('');
const shipTarget = ref<AdminFulfillmentDetail | null>(null);
const shipForm = ref({ quantityGrams: '', company: '', trackingNo: '', isReissue: false, reason: '' });
const shipping = ref(false);

const FULFILLMENT_STATUS: Record<string, string> = { pending_shipment: '待发货', partially_shipped: '部分发货', shipped: '已发货', completed: '已完成' };

async function load(targetPage = 1) {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await listFulfillmentGroups({ status: statusFilter.value || undefined, page: targetPage, pageSize: 10 });
    items.value = result.items;
    total.value = result.total;
    page.value = targetPage;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '读取失败';
  } finally {
    loading.value = false;
  }
}

async function openDetail(groupId: string) {
  loading.value = true;
  error.value = '';
  try {
    const result = await getFulfillmentGroup(groupId);
    detail.value = result.items;
    detailGroupId.value = result.groupId;
    tab.value = 'detail';
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '读取失败';
  } finally {
    loading.value = false;
  }
}

function backToList() {
  tab.value = 'groups';
  detail.value = [];
  void load(page.value);
}

function openShip(item: AdminFulfillmentDetail) {
  shipTarget.value = item;
  shipForm.value = { quantityGrams: String(item.allocatedQuantityGrams - sumShipped(item)), company: '', trackingNo: '', isReissue: false, reason: '' };
  error.value = '';
}

function sumShipped(item: AdminFulfillmentDetail): number {
  return item.shipments.filter((s) => !s.isReissue).reduce((sum, s) => sum + s.quantityGrams, 0);
}

async function confirmShip() {
  if (!shipTarget.value || shipping.value) return;
  const quantityGrams = Number(shipForm.value.quantityGrams);
  if (!Number.isInteger(quantityGrams) || quantityGrams <= 0) { error.value = '发货数量必须为正整数克'; return; }
  if (!shipForm.value.company.trim() || !shipForm.value.trackingNo.trim()) { error.value = '快递公司与运单号必填'; return; }
  if (shipForm.value.isReissue && !shipForm.value.reason.trim()) { error.value = '补发必须填写原因'; return; }
  shipping.value = true;
  error.value = '';
  try {
    const result = await shipFulfillmentOrder(shipTarget.value.fulfillmentOrderId, {
      quantityGrams,
      company: shipForm.value.company.trim(),
      trackingNo: shipForm.value.trackingNo.trim(),
      isReissue: shipForm.value.isReissue,
      reason: shipForm.value.reason.trim() || undefined
    });
    notice.value = `已发货（${result.fulfillmentOrder.status === 'shipped' ? '全部发货' : '部分发货'}）`;
    shipTarget.value = null;
    await openDetail(detailGroupId.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '发货失败';
  } finally {
    shipping.value = false;
  }
}

function exportCsv() {
  // 导出含收货明文（面单必需），带 token 下载；服务端写审计
  const token = storedToken();
  const url = exportShipmentsCsv(detailGroupId.value);
  void (async () => {
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) { error.value = `导出失败（HTTP ${response.status}）`; return; }
    const blob = await response.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `shipments-${detailGroupId.value}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  })();
}

const totalPages = () => Math.max(1, Math.ceil(total.value / 10));
onMounted(() => load(1));
</script>

<template>
  <div class="toolbar">
    <div>
      <h2>履约管理</h2>
      <p>成功组按份额自动生成每用户履约单；发货数量以整数克计（1 斤 = 500 克），Σ非补发包裹 = 分配数量即全部发货。</p>
    </div>
    <div class="controls">
      <button type="button" :class="{ primary: tab === 'groups' }" @click="backToList">拼单组</button>
      <button v-if="detailGroupId" type="button" :class="{ primary: tab === 'detail' }" @click="tab = 'detail'">组明细</button>
    </div>
  </div>

  <div v-if="tab === 'groups'" class="controls" style="margin-bottom: 16px">
    <select v-model="statusFilter" aria-label="履约状态筛选" @change="load(1)">
      <option value="">全部状态</option>
      <option value="pending_shipment">待发货</option>
      <option value="partially_shipped">部分发货</option>
      <option value="shipped">已发货</option>
      <option value="completed">已完成</option>
    </select>
    <button type="button" :disabled="loading" @click="load(1)">查询</button>
  </div>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="notice" class="hint" role="status">{{ notice }}</p>
  <p v-if="loading" role="status">正在读取…</p>

  <table v-if="tab === 'groups' && items.length" class="data-table">
    <thead><tr><th>拼单组</th><th>商品</th><th>成功时间</th><th>履约进度（待发/部分/已发/完成）</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="group in items" :key="group.groupId">
        <td class="name-cell">{{ group.groupId }}<small>{{ group.productName }}</small></td>
        <td>{{ group.productName }}</td>
        <td>{{ new Date(group.succeededAt).toLocaleString() }}</td>
        <td>{{ group.pending }} / {{ group.partially }} / {{ group.shipped }} / {{ group.completed }}（共 {{ group.total }}）</td>
        <td class="actions"><button type="button" @click="openDetail(group.groupId)">查看明细</button></td>
      </tr>
    </tbody>
  </table>

  <div v-if="tab === 'groups' && !items.length && !loading && !error" class="placeholder"><h2>暂无数据</h2><p>拼单成功后此处展示履约组。</p></div>

  <div v-if="tab === 'groups' && items.length" class="pager">
    <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
    <span>第 {{ page }} / {{ totalPages() }} 页 · 共 {{ total }} 条</span>
    <button type="button" :disabled="page >= totalPages() || loading" @click="load(page + 1)">下一页</button>
  </div>

  <template v-if="tab === 'detail'">
    <div class="toolbar">
      <div><h3>组明细 · {{ detailGroupId }}</h3></div>
      <div class="controls">
        <button type="button" @click="exportCsv">导出发货单 CSV</button>
      </div>
    </div>

    <table v-if="detail.length" class="data-table">
      <thead><tr><th>用户 / 订单</th><th>份额</th><th>应发数量</th><th>状态</th><th>收货人</th><th>包裹 / 运单</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="item in detail" :key="item.fulfillmentOrderId">
          <td class="name-cell">{{ item.nickname }}<small>{{ item.orderNo }}</small></td>
          <td>{{ item.units }}/60</td>
          <td>{{ item.allocatedQuantityText }} 斤（{{ item.allocatedQuantityGrams }}g）</td>
          <td><span class="badge" :class="{ warn: item.status !== 'shipped' && item.status !== 'completed' }">{{ FULFILLMENT_STATUS[item.status] }}</span></td>
          <td>{{ item.receiver.name }}<small>{{ item.receiver.phoneMasked }} · {{ item.receiver.province }}{{ item.receiver.city }}{{ item.receiver.district }}</small></td>
          <td>
            <div v-for="shipment in item.shipments" :key="shipment.id" style="font-size: 12px">
              {{ shipment.isReissue ? '[补发]' : '' }}{{ shipment.company }} {{ shipment.trackingNo }}（{{ shipment.quantityText }} 斤）
            </div>
            <span v-if="!item.shipments.length" style="color: #999">暂无</span>
          </td>
          <td class="actions"><button v-if="item.status !== 'completed'" type="button" @click="openShip(item)">发货 / 补发</button></td>
        </tr>
      </tbody>
    </table>
    <p v-if="!loading && !detail.length && !error" class="placeholder"><h2>暂无履约单</h2></p>
  </template>

  <div v-if="shipTarget" class="detail-panel">
    <div class="panel-head"><h3>发货 · {{ shipTarget.orderNo }}（应发 {{ shipTarget.allocatedQuantityText }} 斤）</h3><button type="button" @click="shipTarget = null">关闭</button></div>
    <dl class="detail-grid">
      <div><dt>收货人</dt><dd>{{ shipTarget.receiver.name }} {{ shipTarget.receiver.phoneMasked }}</dd></div>
      <div><dt>地址</dt><dd>{{ shipTarget.receiver.province }}{{ shipTarget.receiver.city }}{{ shipTarget.receiver.district }} {{ shipTarget.receiver.detail }}</dd></div>
      <div><dt>已发货</dt><dd>{{ sumShipped(shipTarget) }} g / {{ shipTarget.allocatedQuantityGrams }} g</dd></div>
    </dl>
    <div class="controls" style="flex-wrap: wrap; gap: 8px">
      <input v-model="shipForm.quantityGrams" placeholder="本次数量（克）" aria-label="发货数量（克）" style="width: 140px" />
      <input v-model="shipForm.company" placeholder="快递公司" aria-label="快递公司" style="width: 120px" />
      <input v-model="shipForm.trackingNo" placeholder="运单号" aria-label="运单号" style="width: 180px" />
      <label style="display: flex; align-items: center; gap: 4px"><input v-model="shipForm.isReissue" type="checkbox" />补发</label>
      <input v-if="shipForm.isReissue" v-model="shipForm.reason" placeholder="补发原因（必填）" aria-label="补发原因" style="width: 180px" />
      <button type="button" class="primary" :disabled="shipping" @click="confirmShip">{{ shipping ? '提交中…' : '确认发货' }}</button>
    </div>
    <p class="hint">非补发发货计入进度：Σ数量 = 分配数量即全部发货；补发仅记录轨迹，不改变进度。运单号全局唯一。</p>
  </div>
</template>
