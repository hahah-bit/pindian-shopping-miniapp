<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminFulfillmentDetail, AdminFulfillmentGroupSummary } from '@pindian/contracts';
import { ApiClientError, completeFulfillmentOrder, exportShipmentsCsv, getFulfillmentGroup, listFulfillmentGroups, shipFulfillmentOrder, updateFulfillmentReceiver } from '../../platform/api-client';
import { storedToken, request } from '../../platform/api-client';

/** 履约管理（T007 F028）：待履约组、分配明细、发货/补发、导出发货单。发货数量以整数最小计量单位填写。 */

import {post} from '../admin-cs/api';
const anomalyPending=ref<{groupId:string;orderId:string;body:{reason:string;clientRequestId:string}}|null>(null);
const anomalyBusy=ref(false),anomalyTicket=ref('');
async function anomaly(groupId:string,orderId:string){
  if(anomalyBusy.value)return;
  anomalyPending.value??={groupId,orderId,body:{reason:'历史零分配异常，申请按实际支付金额全额退款',clientRequestId:crypto.randomUUID()}};
  const p=anomalyPending.value;anomalyBusy.value=true;error.value='';
  try{const r=await post<{request:{ticketId:string}}>('/api/admin/v1/fulfillment/blocks/'+p.groupId+'/orders/'+p.orderId+'/refund-request',p.body);anomalyTicket.value=r.request.ticketId;anomalyPending.value=null;notice.value='退款申请已提交，等待超级管理员审核';}catch(e){error.value=e instanceof Error?e.message:'申请失败';}finally{anomalyBusy.value=false;}
}
const tab = ref<'groups' | 'detail'>('groups');
const items = ref<AdminFulfillmentGroupSummary[]>([]);
const blocks = ref<Array<{groupId:string;reason:string;orderIds:string[]}>>([]);
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
const receiverTarget = ref<AdminFulfillmentDetail | null>(null);
const receiverForm = ref({ receiverName: '', phone: '', province: '', city: '', district: '', detail: '' });
const savingReceiver = ref(false);
const completingId = ref('');

const FULFILLMENT_STATUS: Record<string, string> = { pending_shipment: '待发货', partially_shipped: '部分发货', shipped: '已发货', completed: '已完成' };

async function load(targetPage = 1) {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await listFulfillmentGroups({ status: statusFilter.value || undefined, page: targetPage, pageSize: 10 });
    blocks.value = (await request<{items:typeof blocks.value}>('/api/admin/v1/fulfillment/blocks')).items;
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

function openReceiver(item: AdminFulfillmentDetail) {
  receiverTarget.value = item;
  receiverForm.value = { receiverName: item.receiver.name, phone: '', province: item.receiver.province, city: item.receiver.city, district: item.receiver.district, detail: item.receiver.detail };
  error.value = '';
}

async function confirmReceiver() {
  if (!receiverTarget.value || savingReceiver.value) return;
  const form = receiverForm.value;
  if (!form.receiverName.trim() || !form.phone.trim() || !form.detail.trim()) { error.value = '收货人/电话/详址必填'; return; }
  savingReceiver.value = true;
  error.value = '';
  try {
    await updateFulfillmentReceiver(receiverTarget.value.fulfillmentOrderId, {
      receiverName: form.receiverName.trim(), phone: form.phone.trim(),
      province: form.province.trim(), city: form.city.trim(), district: form.district.trim(), detail: form.detail.trim()
    });
    notice.value = '收货信息已更新（新版本）';
    receiverTarget.value = null;
    await openDetail(detailGroupId.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '改址失败';
  } finally {
    savingReceiver.value = false;
  }
}

async function markComplete(item: AdminFulfillmentDetail) {
  if (!window.confirm(`确认将 ${item.orderNo} 标记为已完成？`)) return;
  completingId.value = item.fulfillmentOrderId;
  error.value = '';
  try {
    await completeFulfillmentOrder(item.fulfillmentOrderId);
    notice.value = '已标记完成';
    await openDetail(detailGroupId.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '标记失败';
  } finally {
    completingId.value = '';
  }
}

/** 数量字段单位语义（D011）：weight=克、countable=件（*Grams 字段复用为最小履约单位数）。 */
function quantityTypeOf(item: AdminFulfillmentDetail): 'weight' | 'countable' {
  return ['斤', '千克', 'kg', '克', 'g', '两'].includes(item.unit.trim()) ? 'weight' : 'countable';
}

function quantityLabel(item: AdminFulfillmentDetail): string {
  return quantityTypeOf(item) === 'weight' ? '克' : item.unit.trim() || '件';
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
  <section v-if="blocks.length && tab === 'groups'" class="error"><h3>暂停履约，待审核处理</h3><p>历史数量保持不变；以下拼单组没有生成履约单，需要按订单处理售后。</p><article v-for="b in blocks" :key="b.groupId"><strong>拼单组 {{b.groupId.slice(0,8)}} · {{b.reason==='ZERO_ALLOCATION'?'数量配置导致零分配':'数量无法履约'}}</strong><p>涉及 {{b.orderIds.length}} 笔订单</p><div v-for="id in b.orderIds" :key="id"><span>订单 {{id}}</span><button v-if="b.reason==='ZERO_ALLOCATION'" :disabled="anomalyBusy||!!anomalyPending" @click="anomaly(b.groupId,id)">申请审核退款</button></div></article></section>

  <p v-if="anomalyPending">申请结果尚未确认。<button :disabled="anomalyBusy" @click="anomaly(anomalyPending.groupId,anomalyPending.orderId)">重试原申请</button><button :disabled="anomalyBusy" @click="anomalyPending=null">放弃重试</button></p><a v-if="anomalyTicket" :href="'#/after-sales?ticketId='+anomalyTicket">查看异常退款工单</a>
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
          <td>{{ item.allocatedQuantityText }} {{ item.unit }}（{{ item.allocatedQuantityGrams }} 最小单位）</td>
          <td><span class="badge" :class="{ warn: item.status !== 'shipped' && item.status !== 'completed' }">{{ FULFILLMENT_STATUS[item.status] }}</span></td>
          <td>{{ item.receiver.name }}<small>{{ item.receiver.phoneMasked }} · {{ item.receiver.province }}{{ item.receiver.city }}{{ item.receiver.district }}</small></td>
          <td>
            <div v-for="shipment in item.shipments" :key="shipment.id" style="font-size: 12px">
              {{ shipment.isReissue ? '[补发]' : '' }}{{ shipment.company }} {{ shipment.trackingNo }}（{{ shipment.quantityText }} {{ item.unit }}）
            </div>
            <span v-if="!item.shipments.length" style="color: #999">暂无</span>
          </td>
          <td class="actions">
            <button type="button" @click="openShip(item)">正常发货</button><a href="#/after-sales">售后补发申请</a>
            <button v-if="item.status === 'pending_shipment' && item.shipments.length === 0" type="button" @click="openReceiver(item)">改收货</button>
            <button v-if="item.status === 'shipped'" type="button" :disabled="completingId === item.fulfillmentOrderId" @click="markComplete(item)">{{ completingId === item.fulfillmentOrderId ? '提交中…' : '标记完成' }}</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!loading && !detail.length && !error" class="placeholder"><h2>暂无履约单</h2></div>
  </template>

  <div v-if="shipTarget" class="detail-panel">
    <div class="panel-head"><h3>发货 · {{ shipTarget.orderNo }}（应发 {{ shipTarget.allocatedQuantityText }} {{shipTarget.unit}}）</h3><button type="button" @click="shipTarget = null">关闭</button></div>
    <dl class="detail-grid">
      <div><dt>收货人</dt><dd>{{ shipTarget.receiver.name }} {{ shipTarget.receiver.phoneMasked }}</dd></div>
      <div><dt>地址</dt><dd>{{ shipTarget.receiver.province }}{{ shipTarget.receiver.city }}{{ shipTarget.receiver.district }} {{ shipTarget.receiver.detail }}</dd></div>
      <div><dt>已发货</dt><dd>{{ sumShipped(shipTarget) }} {{ quantityLabel(shipTarget) }} / {{ shipTarget.allocatedQuantityGrams }} {{ quantityLabel(shipTarget) }}（应发 {{ shipTarget.allocatedQuantityText }} {{ shipTarget.unit }}）</dd></div>
    </dl>
    <div class="controls" style="flex-wrap: wrap; gap: 8px">
      <input v-model="shipForm.quantityGrams" :placeholder="`本次数量（${quantityLabel(shipTarget)}）`" :aria-label="`发货数量（${quantityLabel(shipTarget)}）`" style="width: 140px" />
      <input v-model="shipForm.company" placeholder="快递公司" aria-label="快递公司" style="width: 120px" />
      <input v-model="shipForm.trackingNo" placeholder="运单号" aria-label="运单号" style="width: 180px" />

      <button type="button" class="primary" :disabled="shipping" @click="confirmShip">{{ shipping ? '提交中…' : '确认发货' }}</button>
    </div>
    <p class="hint">非补发发货计入进度：Σ数量 = 分配数量即全部发货；补发仅记录轨迹，不改变进度。运单号全局唯一。数量单位按商品：重量商品为**克**、计数商品为**{{ shipTarget.unit }}**（件数）。</p>
  </div>

  <div v-if="receiverTarget" class="detail-panel">
    <div class="panel-head"><h3>修改收货信息 · {{ receiverTarget.orderNo }}（当前版本 v{{ receiverTarget.receiver.version }}）</h3><button type="button" @click="receiverTarget = null">关闭</button></div>
    <p class="hint">仅发货前可修改；保存后版本 +1 并写审计。电话输入原文（内部保存，展示仍脱敏）。</p>
    <div class="controls" style="flex-wrap: wrap; gap: 8px">
      <input v-model="receiverForm.receiverName" placeholder="收货人" aria-label="收货人" style="width: 110px" />
      <input v-model="receiverForm.phone" placeholder="电话（原文）" aria-label="电话" style="width: 140px" />
      <input v-model="receiverForm.province" placeholder="省" aria-label="省" style="width: 90px" />
      <input v-model="receiverForm.city" placeholder="市" aria-label="市" style="width: 90px" />
      <input v-model="receiverForm.district" placeholder="区" aria-label="区" style="width: 90px" />
      <input v-model="receiverForm.detail" placeholder="详址" aria-label="详址" style="width: 220px" />
      <button type="button" class="primary" :disabled="savingReceiver" @click="confirmReceiver">{{ savingReceiver ? '保存中…' : '保存' }}</button>
    </div>
  </div>
</template>
