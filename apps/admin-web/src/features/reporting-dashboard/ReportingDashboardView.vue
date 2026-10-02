<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { AdminProfile, ReportingOverviewResult, ReportingCsResult } from '@pindian/contracts';
import { getReportingOverview, getReportingCs, ApiClientError } from '../../platform/api-client';

const props = defineProps<{ principal: AdminProfile | null }>();

const overview = ref<ReportingOverviewResult | null>(null);
const cs = ref<ReportingCsResult | null>(null);
const loading = ref(false);
const error = ref('');
const dateText = ref('');

const canViewOverview = computed(() => Boolean(props.principal?.permissions.includes('reporting:view')));
const canViewCs = computed(() => Boolean(props.principal?.permissions.includes('reporting:view_cs')));

function todayShanghai(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

function formatFen(fen: number | null | undefined): string {
  if (fen === null || fen === undefined) return '—';
  const abs = Math.abs(Math.trunc(fen));
  return `${fen < 0 ? '-' : ''}¥${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${Math.round(value * 10000) / 100}%`;
}

function formatMinutes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value >= 60) return `${Math.floor(value / 60)} 小时 ${Math.round(value % 60)} 分`;
  return `${Math.round(value)} 分钟`;
}

const overviewCards = computed(() => {
  if (!overview.value) return [];
  const o = overview.value.overview;
  return [
    { label: '商品总数（上架）', value: `${o.totalProducts}（${o.onShelfProducts}）` },
    { label: '进行中拼单', value: String(o.openGroups) },
    { label: '成功拼单', value: String(o.successGroups) },
    { label: '失败拼单', value: String(o.failedGroups) },
    { label: '今日订单数', value: String(o.todayOrders) },
    { label: '今日支付金额', value: formatFen(o.todayPaidAmountFen) },
    { label: '平台服务费收入', value: formatFen(o.serviceFeeIncomeFen) },
    { label: '待退款金额', value: formatFen(o.pendingRefundAmountFen) },
    { label: '待发货订单', value: String(o.pendingShipmentCount) },
    { label: '客服待处理', value: String(o.csPendingCount) },
    { label: '退款（申请/受理/到账）', value: `${formatFen(o.refundRequestedFen)} / ${formatFen(o.refundAcceptedFen)} / ${formatFen(o.refundSucceededFen)}` }
  ];
});

const productCards = computed(() => {
  if (!overview.value) return [];
  const p = overview.value.product;
  return [
    { label: '商品库存（整件）', value: String(p.stockWholeItems) },
    { label: '拼单组（创建/进行/成功）', value: `${p.createdGroups} / ${p.openGroups} / ${p.successGroups}` },
    { label: '参与用户数', value: String(p.paidUserCount) },
    { label: '拼单成功率', value: formatRate(p.successRate) },
    { label: '平均拼单耗时', value: formatMinutes(p.avgGroupDurationMinutes) },
    { label: '商品金额', value: formatFen(p.goodsAmountFen) },
    { label: '平台服务费金额', value: formatFen(p.serviceFeeAmountFen) },
    { label: '退款金额（已到账）', value: formatFen(p.refundedAmountFen) }
  ];
});

const csCards = computed(() => {
  if (!cs.value) return [];
  const c = cs.value.cs;
  return [
    { label: '今日咨询人数', value: String(c.todayConsultUsers) },
    { label: '当前排队人数', value: String(c.queuedCount) },
    { label: '在线客服数', value: String(c.onlineAgentCount) },
    { label: '平均首次响应', value: formatMinutes(c.avgFirstResponseMinutes) },
    { label: '平均会话时长', value: formatMinutes(c.avgSessionDurationMinutes) },
    { label: '未处理会话数', value: String(c.unhandledCount) },
    { label: '工单数量', value: String(c.ticketCount) },
    { label: '工单解决率', value: formatRate(c.ticketResolveRate) },
    { label: '超时未回复会话', value: String(c.overdueFirstResponseCount) }
  ];
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    if (canViewOverview.value) overview.value = await getReportingOverview(dateText.value || undefined);
    if (canViewCs.value) cs.value = await getReportingCs(dateText.value || undefined);
    if (!canViewOverview.value && !canViewCs.value) {
      error.value = '当前角色没有看板查看权限';
    }
  } catch (cause) {
    overview.value = null;
    cs.value = null;
    error.value = cause instanceof ApiClientError ? cause.message : '无法连接后端';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="toolbar">
      <div>
        <h2>运营看板</h2>
        <p>基于订单、支付、退款、履约与客服工单真实事实统计；时区 Asia/Shanghai，金额为整数分的人民币元展示。</p>
      </div>
      <div class="controls">
        <label>基准日 <input v-model="dateText" type="date" :max="todayShanghai()" /></label>
        <button type="button" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新' }}</button>
      </div>
    </div>

    <p v-if="error" class="error" role="alert">{{ error }} <button v-if="canViewOverview || canViewCs" type="button" @click="load">重试</button></p>
    <p v-else-if="loading && !overview && !cs" class="hint">正在加载看板数据…</p>

    <template v-if="overview">
      <h3>总览（{{ overview.date }}）</h3>
      <div class="summary-grid">
        <div v-for="card in overviewCards" :key="card.label" class="summary">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </div>
      </div>
      <h3>商品数据</h3>
      <div class="summary-grid">
        <div v-for="card in productCards" :key="card.label" class="summary">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </div>
      </div>
      <p class="hint">统计时点：{{ overview.generatedAt }}（退款三态：申请=待处理，受理=已提交渠道，到账=渠道确认成功）</p>
    </template>

    <template v-if="cs">
      <h3>客服数据（{{ cs.date }}）</h3>
      <div class="summary-grid">
        <div v-for="card in csCards" :key="card.label" class="summary">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
        </div>
      </div>
      <h3>问题类型统计</h3>
      <p v-if="!cs.cs.ticketTypeStats.length" class="hint">暂无工单数据</p>
      <table v-else class="data-table compact">
        <thead><tr><th>类型</th><th>数量</th></tr></thead>
        <tbody>
          <tr v-for="item in cs.cs.ticketTypeStats" :key="item.type">
            <td>{{ item.type }}</td><td>{{ item.count }}</td>
          </tr>
        </tbody>
      </table>
      <h3>客服接待量</h3>
      <p v-if="!cs.cs.agentLoad.length" class="hint">暂无已接入会话</p>
      <table v-else class="data-table compact">
        <thead><tr><th>客服</th><th>累计接待会话</th></tr></thead>
        <tbody>
          <tr v-for="item in cs.cs.agentLoad" :key="item.agentId">
            <td>{{ item.displayName }}</td><td>{{ item.conversations }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
