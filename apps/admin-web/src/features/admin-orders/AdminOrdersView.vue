<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminGroupListItem, AdminOrderListItem } from '@pindian/contracts';
import { ApiClientError, formatFen, listAdminGroups, getAdminGroup, listAdminOrders, getAdminOrder } from '../../platform/api-client';

interface OrderDetail extends Record<string, unknown> {
  id: string; orderNo: string; status: 'unpaid' | 'paid' | 'cancelled' | 'expired'; units: number; nickname: string;
  quote: { totalAmountFen: number; goodsAmountFen: number; serviceFeeFen: number; tailAdjustFen: number; isFinalOrder: boolean };
  productSnapshot: { originalPriceFen: number; unit: string; wholeQuantityText: string; referenceQuantityText: string };
  addressSummary: { receiverName: string; phoneMasked: string; province: string; city: string; district: string };
  createdAt: string;
}

interface GroupDetail extends Record<string, unknown> {
  id: string; productId: string; status: 'open' | 'success' | 'failed'; paidUnits: number; reservedUnits: number; remainingCapacity: number;
  deadline: string; snapshot: SalePolicySnapshotLite; members: { orderNo: string; nickname: string; units: number; status: string }[];
}
interface SalePolicySnapshotLite { originalPriceFen: number; allowedShareUnits: number[]; wholeQuantityText: string; unit: string }

const tab = ref<'orders' | 'groups'>('orders');
const orderItems = ref<AdminOrderListItem[]>([]);
const groupItems = ref<AdminGroupListItem[]>([]);
const page = ref(1);
const total = ref(0);
const statusFilter = ref('');
const keyword = ref('');
const loading = ref(false);
const error = ref('');
const orderDetail = ref<OrderDetail | null>(null);
const groupDetail = ref<GroupDetail | null>(null);

const ORDER_STATUS: Record<string, string> = { unpaid: '待支付', paid: '已支付', cancelled: '已取消', expired: '已失效' };
const GROUP_STATUS: Record<string, string> = { open: '拼单中', success: '拼单成功', failed: '拼单失败' };

async function load(targetPage = 1) {
  loading.value = true;
  error.value = '';
  try {
    if (tab.value === 'orders') {
      const result = await listAdminOrders({ status: statusFilter.value || undefined, keyword: keyword.value.trim() || undefined, page: targetPage, pageSize: 10 });
      orderItems.value = result.items;
      total.value = result.total;
    } else {
      const result = await listAdminGroups({ status: statusFilter.value || undefined, page: targetPage, pageSize: 10 });
      groupItems.value = result.items;
      total.value = result.total;
    }
    page.value = targetPage;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '读取失败';
  } finally {
    loading.value = false;
  }
}

function switchTab(next: 'orders' | 'groups') {
  tab.value = next;
  statusFilter.value = '';
  keyword.value = '';
  orderDetail.value = null;
  groupDetail.value = null;
  void load(1);
}

async function openOrder(id: string) {
  error.value = '';
  try { orderDetail.value = await getAdminOrder(id) as OrderDetail; groupDetail.value = null; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取失败'; }
}

async function openGroup(id: string) {
  error.value = '';
  try { groupDetail.value = await getAdminGroup(id) as GroupDetail; orderDetail.value = null; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '读取失败'; }
}

const totalPages = () => Math.max(1, Math.ceil(total.value / 10));
onMounted(() => load(1));
</script>

<template>
  <div class="toolbar">
    <div><h2>拼单与订单</h2><p>查询订单、拼单组进度与容量；本阶段不提供改状态或支付操作。</p></div>
    <div class="controls">
      <button type="button" :class="{ primary: tab === 'orders' }" @click="switchTab('orders')">订单</button>
      <button type="button" :class="{ primary: tab === 'groups' }" @click="switchTab('groups')">拼单组</button>
    </div>
  </div>

  <div class="controls" style="margin-bottom: 16px">
    <select v-if="tab === 'orders'" v-model="statusFilter" aria-label="状态筛选" @change="load(1)">
      <option value="">全部状态</option>
      <option value="unpaid">待支付</option>
      <option value="paid">已支付</option>
      <option value="cancelled">已取消</option>
      <option value="expired">已失效</option>
    </select>
    <select v-else v-model="statusFilter" aria-label="组状态筛选" @change="load(1)">
      <option value="">全部状态</option>
      <option value="open">拼单中</option>
      <option value="success">拼单成功</option>
      <option value="failed">拼单失败</option>
    </select>
    <input v-model="keyword" placeholder="订单号/收货人（订单 Tab）" aria-label="关键字" @keyup.enter="load(1)" />
    <button type="button" :disabled="loading" @click="load(1)">查询</button>
  </div>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="loading && !orderItems.length && !groupItems.length" role="status">正在读取…</p>

  <table v-if="tab === 'orders' && orderItems.length" class="data-table">
    <thead><tr><th>订单号</th><th>用户</th><th>份额</th><th>应付</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="order in orderItems" :key="order.id">
        <td class="name-cell">{{ order.orderNo }}<small>{{ order.id }}</small></td>
        <td>{{ order.nickname }}</td>
        <td>{{ order.units }}/60</td>
        <td>¥{{ formatFen(order.totalAmountFen) }}</td>
        <td><span class="badge" :class="{ warn: order.status !== 'paid' }">{{ ORDER_STATUS[order.status] }}</span></td>
        <td>{{ new Date(order.createdAt).toLocaleString() }}</td>
        <td class="actions"><button type="button" @click="openOrder(order.id)">详情</button></td>
      </tr>
    </tbody>
  </table>

  <table v-if="tab === 'groups' && groupItems.length" class="data-table">
    <thead><tr><th>组 ID</th><th>进度（已支付+预占/60）</th><th>剩余</th><th>状态</th><th>截止时间</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="group in groupItems" :key="group.id">
        <td class="name-cell">{{ group.id }}<small>商品 {{ group.productId.slice(0, 8) }}…</small></td>
        <td>{{ group.paidUnits }} + {{ group.reservedUnits }} / 60</td>
        <td>{{ group.remainingCapacity }}</td>
        <td><span class="badge" :class="{ warn: group.status === 'failed' }">{{ GROUP_STATUS[group.status] }}</span></td>
        <td>{{ new Date(group.deadline).toLocaleString() }}</td>
        <td class="actions"><button type="button" @click="openGroup(group.id)">详情</button></td>
      </tr>
    </tbody>
  </table>

  <div v-if="!loading && !orderItems.length && !groupItems.length && !error" class="placeholder"><h2>暂无数据</h2><p>{{ tab === 'orders' ? '用户下单后此处展示订单。' : '商品下单后自动创建拼单组。' }}</p></div>

  <div v-if="orderItems.length || groupItems.length" class="pager">
    <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
    <span>第 {{ page }} / {{ totalPages() }} 页 · 共 {{ total }} 条</span>
    <button type="button" :disabled="page >= totalPages() || loading" @click="load(page + 1)">下一页</button>
  </div>

  <div v-if="orderDetail" class="detail-panel">
    <div class="panel-head"><h3>订单详情 · {{ orderDetail.orderNo }}</h3><button type="button" @click="orderDetail = null">关闭</button></div>
    <dl class="detail-grid">
      <div><dt>用户</dt><dd>{{ orderDetail.nickname }}</dd></div>
      <div><dt>状态</dt><dd>{{ ORDER_STATUS[orderDetail.status] }}</dd></div>
      <div><dt>份额</dt><dd>{{ orderDetail.units }}/60 单位</dd></div>
      <div><dt>商品金额</dt><dd>¥{{ formatFen(orderDetail.quote.goodsAmountFen) }}</dd></div>
      <div><dt>服务费</dt><dd>¥{{ formatFen(orderDetail.quote.serviceFeeFen) }}</dd></div>
      <div v-if="orderDetail.quote.tailAdjustFen !== 0"><dt>尾差调整（{{ orderDetail.quote.isFinalOrder ? '最后单' : '' }}）</dt><dd>¥{{ formatFen(orderDetail.quote.tailAdjustFen) }}</dd></div>
      <div><dt>应付</dt><dd><strong>¥{{ formatFen(orderDetail.quote.totalAmountFen) }}</strong></dd></div>
      <div><dt>收货人</dt><dd>{{ orderDetail.addressSummary.receiverName }} {{ orderDetail.addressSummary.phoneMasked }}（{{ orderDetail.addressSummary.province }}{{ orderDetail.addressSummary.city }}{{ orderDetail.addressSummary.district }}）</dd></div>
      <div><dt>下单时间</dt><dd>{{ new Date(orderDetail.createdAt).toLocaleString() }}</dd></div>
    </dl>
    <p class="hint">完整地址与手机号不在此展示；订单为用户隐私数据，地址快照属于订单历史。</p>
  </div>

  <div v-if="groupDetail" class="detail-panel">
    <div class="panel-head"><h3>拼单组详情</h3><button type="button" @click="groupDetail = null">关闭</button></div>
    <dl class="detail-grid">
      <div><dt>状态</dt><dd>{{ GROUP_STATUS[groupDetail.status] }}</dd></div>
      <div><dt>进度</dt><dd>已支付 {{ groupDetail.paidUnits }} + 预占 {{ groupDetail.reservedUnits }} / 60（剩余 {{ groupDetail.remainingCapacity }}）</dd></div>
      <div><dt>组快照原价</dt><dd>¥{{ formatFen(groupDetail.snapshot.originalPriceFen) }} + 5 元服务费</dd></div>
      <div><dt>允许份额</dt><dd>{{ groupDetail.snapshot.allowedShareUnits.map((u) => u + '/60').join('、') }}</dd></div>
      <div><dt>截止时间</dt><dd>{{ new Date(groupDetail.deadline).toLocaleString() }}</dd></div>
    </dl>
    <h4>成员订单（不显示手机号/地址）</h4>
    <table v-if="groupDetail.members.length" class="data-table compact">
      <thead><tr><th>订单号</th><th>昵称</th><th>份额</th><th>预占状态</th></tr></thead>
      <tbody>
        <tr v-for="member in groupDetail.members" :key="member.orderNo">
          <td>{{ member.orderNo }}</td><td>{{ member.nickname }}</td><td>{{ member.units }}/60</td><td>{{ member.status }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="hint">暂无成员。</p>
  </div>
</template>
