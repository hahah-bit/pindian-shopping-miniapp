<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminPaymentListItem, AdminRefundListItem, PaymentAnomaliesView } from '@pindian/contracts';
import { ApiClientError, formatFen, getPaymentAnomalies, listAdminPayments, listAdminRefunds, retryAdminRefund } from '../../platform/api-client';

/** 支付与退款（T006 F025）：列表/异常队列/失败退款人工重试。状态推进只由渠道与 Worker 驱动，重试是唯一人工动作。 */

const tab = ref<'payments' | 'refunds' | 'anomalies'>('payments');
const payments = ref<AdminPaymentListItem[]>([]);
const refunds = ref<AdminRefundListItem[]>([]);
const anomalies = ref<PaymentAnomaliesView | null>(null);
const page = ref(1);
const total = ref(0);
const statusFilter = ref('');
const loading = ref(false);
const error = ref('');
const notice = ref('');
const retryTarget = ref<AdminRefundListItem | null>(null);
const retryReason = ref('');
const retrying = ref(false);

const PAY_STATUS: Record<string, string> = { created: '已创建', processing: '支付中', unknown: '结果未知', succeeded: '支付成功', closed: '已关闭' };
const REFUND_STATUS: Record<string, string> = { requested: '待提交', submitted: '已提交', processing: '退款中', succeeded: '已到账', failed: '失败' };
const REFUND_REASON: Record<string, string> = { user_cancel: '用户取消', group_failed: '拼单失败', late_payment: '迟到支付', after_sales: '审核售后退款' };
const APPLIED_RESULT: Record<string, string> = { applied: '已生效', refunded_not_applied: '不适用（已转退款）', pending_review: '待人工复核' };

async function load(targetPage = 1) {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    if (tab.value === 'payments') {
      const result = await listAdminPayments({ status: statusFilter.value || undefined, page: targetPage, pageSize: 10 });
      payments.value = result.items; total.value = result.total;
    } else if (tab.value === 'refunds') {
      const result = await listAdminRefunds({ status: statusFilter.value || undefined, page: targetPage, pageSize: 10 });
      refunds.value = result.items; total.value = result.total;
    } else {
      anomalies.value = await getPaymentAnomalies();
      // 异常页同时展示两类异常明细
      const [pending, failed] = await Promise.all([
        listAdminPayments({ status: 'unknown', page: 1, pageSize: 10 }),
        listAdminRefunds({ status: 'failed', page: 1, pageSize: 10 })
      ]);
      payments.value = pending.items;
      refunds.value = failed.items;
      total.value = failed.total;
    }
    page.value = targetPage;
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '读取失败';
  } finally {
    loading.value = false;
  }
}

function switchTab(next: 'payments' | 'refunds' | 'anomalies') {
  tab.value = next;
  statusFilter.value = '';
  retryTarget.value = null;
  void load(1);
}

function openRetry(refund: AdminRefundListItem) {
  retryTarget.value = refund;
  retryReason.value = '';
  error.value = '';
}

async function confirmRetry() {
  if (!retryTarget.value || retrying.value) return;
  if (!retryReason.value.trim()) { error.value = '请填写重试原因（写入操作审计）'; return; }
  retrying.value = true;
  error.value = '';
  try {
    await retryAdminRefund(retryTarget.value.id, retryReason.value.trim());
    notice.value = '已重新进入退款驱动，等待渠道结果';
    retryTarget.value = null;
    void load(tab.value === 'anomalies' ? 1 : page.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '重试失败';
  } finally {
    retrying.value = false;
  }
}

const totalPages = () => Math.max(1, Math.ceil(total.value / 10));
onMounted(() => load(1));
</script>

<template>
  <div class="toolbar">
    <div><h2>支付与退款</h2><p>支付/退款事实查询与异常处理；金额与状态以后端与渠道证据为权威。</p></div>
    <div class="controls">
      <button type="button" :class="{ primary: tab === 'payments' }" @click="switchTab('payments')">支付单</button>
      <button type="button" :class="{ primary: tab === 'refunds' }" @click="switchTab('refunds')">退款单</button>
      <button type="button" :class="{ primary: tab === 'anomalies' }" @click="switchTab('anomalies')">异常队列</button>
    </div>
  </div>

  <div class="controls" style="margin-bottom: 16px">
    <select v-if="tab !== 'anomalies'" v-model="statusFilter" aria-label="状态筛选" @change="load(1)">
      <template v-if="tab === 'payments'">
        <option value="">全部状态</option>
        <option v-for="(label, key) in PAY_STATUS" :key="key" :value="key">{{ label }}</option>
      </template>
      <template v-else>
        <option value="">全部状态</option>
        <option v-for="(label, key) in REFUND_STATUS" :key="key" :value="key">{{ label }}</option>
      </template>
    </select>
    <button type="button" :disabled="loading" @click="load(tab === 'anomalies' ? 1 : 1)">{{ tab === 'anomalies' ? '刷新异常' : '查询' }}</button>
  </div>

  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="notice" class="hint" role="status">{{ notice }}</p>
  <p v-if="loading" role="status">正在读取…</p>

  <div v-if="tab === 'anomalies' && anomalies" class="detail-panel" style="margin-bottom: 16px">
    <div class="panel-head"><h3>异常计数</h3></div>
    <dl class="detail-grid">
      <div><dt>待人工复核支付（金额不符）</dt><dd><strong>{{ anomalies.pendingReviewPayments }}</strong></dd></div>
      <div><dt>失败退款待处理</dt><dd><strong>{{ anomalies.failedRefunds }}</strong></dd></div>
    </dl>
    <p class="hint">待复核支付需人工比对渠道账单后处理；失败退款可在下方列表中重试。</p>
  </div>

  <table v-if="(tab === 'payments' || tab === 'anomalies') && payments.length" class="data-table">
    <thead><tr><th>商户单号</th><th>金额</th><th>状态</th><th>应用结果</th><th>渠道交易号</th><th>创建时间</th></tr></thead>
    <tbody>
      <tr v-for="payment in payments" :key="payment.id">
        <td class="name-cell">{{ payment.orderNo }}<small>{{ payment.id }}</small></td>
        <td>¥{{ formatFen(payment.amountFen) }}</td>
        <td><span class="badge" :class="{ warn: payment.status === 'unknown' }">{{ PAY_STATUS[payment.status] ?? payment.status }}</span></td>
        <td><span class="badge" :class="{ warn: payment.appliedResult === 'pending_review' }">{{ payment.appliedResult ? (APPLIED_RESULT[payment.appliedResult] ?? payment.appliedResult) : '—' }}</span></td>
        <td>{{ payment.channelTransactionId ?? '—' }}</td>
        <td>{{ new Date(payment.createdAt).toLocaleString() }}</td>
      </tr>
    </tbody>
  </table>

  <table v-if="(tab === 'refunds' || tab === 'anomalies') && refunds.length" class="data-table">
    <thead><tr><th>退款单</th><th>用户</th><th>金额</th><th>状态</th><th>原因</th><th>重试</th><th>失败原因</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="refund in refunds" :key="refund.id">
        <td class="name-cell">{{ refund.orderNo }}<small>{{ refund.id }}</small></td>
        <td>{{ refund.nickname }}</td>
        <td>¥{{ formatFen(refund.amountFen) }}</td>
        <td><span class="badge" :class="{ warn: refund.status === 'failed' }">{{ REFUND_STATUS[refund.status] ?? refund.status }}</span></td>
        <td>{{ REFUND_REASON[refund.reason] ?? refund.reason }}</td>
        <td>{{ refund.retryCount }} 次</td>
        <td>{{ refund.failReason ?? '—' }}</td>
        <td class="actions">
          <button v-if="refund.status === 'failed'" type="button" @click="openRetry(refund)">重试</button>
        </td>
      </tr>
    </tbody>
  </table>

  <div v-if="!loading && !payments.length && !refunds.length && !error" class="placeholder">
    <h2>暂无数据</h2><p>用户支付/退款后此处展示渠道事实。</p>
  </div>

  <div v-if="tab !== 'anomalies' && (payments.length || refunds.length)" class="pager">
    <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
    <span>第 {{ page }} / {{ totalPages() }} 页 · 共 {{ total }} 条</span>
    <button type="button" :disabled="page >= totalPages() || loading" @click="load(page + 1)">下一页</button>
  </div>

  <div v-if="retryTarget" class="detail-panel">
    <div class="panel-head"><h3>重试退款 · {{ retryTarget.orderNo }}</h3><button type="button" @click="retryTarget = null">关闭</button></div>
    <dl class="detail-grid">
      <div><dt>金额</dt><dd>¥{{ formatFen(retryTarget.amountFen) }}</dd></div>
      <div><dt>已重试</dt><dd>{{ retryTarget.retryCount }} 次</dd></div>
      <div><dt>上次失败原因</dt><dd>{{ retryTarget.failReason ?? '—' }}</dd></div>
    </dl>
    <div class="controls">
      <input v-model="retryReason" placeholder="重试原因（必填，写入操作审计）" aria-label="重试原因" @keyup.enter="confirmRetry" />
      <button type="button" class="primary" :disabled="retrying" @click="confirmRetry">{{ retrying ? '提交中…' : '确认重试' }}</button>
    </div>
    <p class="hint">重试将退款单重置为待提交，由退款驱动按原商户退款单号重新提交渠道（渠道幂等）。</p>
  </div>
</template>
