<script setup lang="ts">
import { onMounted, ref } from 'vue';
import type { AdminUserListItem, AdminPhoneReveal } from '@pindian/contracts';
import { ApiClientError, listAdminUsers, getAdminUser, revealAdminUserPhone, disableAdminUser, enableAdminUser } from '../../platform/api-client';

const items = ref<AdminUserListItem[]>([]);
const page = ref(1);
const pageSize = 10;
const total = ref(0);
const keyword = ref('');
const statusFilter = ref('');
const loading = ref(false);
const error = ref('');
const notice = ref('');
const detail = ref<AdminUserListItem | null>(null);
const revealedPhone = ref<string | null>(null);
const revealing = ref(false);
const busyStatus = ref(false);

async function load(targetPage = 1) {
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await listAdminUsers({
      keyword: keyword.value.trim() || undefined,
      status: statusFilter.value || undefined,
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

async function openDetail(user: AdminUserListItem) {
  error.value = '';
  revealedPhone.value = null;
  try {
    detail.value = await getAdminUser(user.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取失败';
  }
}

async function reveal(user: AdminUserListItem) {
  if (revealing.value || !detail.value) return;
  if (!window.confirm('查看完整手机号将记录操作审计（含管理员身份与时间），确定继续？')) return;
  revealing.value = true;
  error.value = '';
  try {
    const result: AdminPhoneReveal = await revealAdminUserPhone(user.id);
    revealedPhone.value = `${result.countryCode === '86' ? '' : '+' + result.countryCode + ' '}${result.phone}`;
    notice.value = '已记录本次查看审计';
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '查看失败';
  } finally {
    revealing.value = false;
  }
}

async function toggleStatus(user: AdminUserListItem) {
  if (busyStatus.value || !detail.value) return;
  const disabling = user.status === 'active';
  const confirmText = disabling
    ? '禁用后该用户将立即退出登录且无法再次登录，直到重新启用。确定禁用？'
    : '启用后该用户可重新登录（原登录态不会恢复）。确定启用？';
  if (!window.confirm(confirmText)) return;
  busyStatus.value = true;
  error.value = '';
  notice.value = '';
  try {
    const updated = disabling ? await disableAdminUser(user.id) : await enableAdminUser(user.id);
    detail.value = updated;
    notice.value = disabling ? '用户已禁用，其全部登录会话已失效' : '用户已启用';
    await load(page.value);
  } catch (cause) {
    error.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '操作失败';
  } finally {
    busyStatus.value = false;
  }
}

const totalPages = () => Math.max(1, Math.ceil(total.value / pageSize));
onMounted(() => load(1));
</script>

<template>
  <div class="toolbar">
    <div><h2>用户管理</h2><p>手机号默认脱敏；查看完整手机号与禁用/启用都会记录审计。</p></div>
    <div class="controls">
      <select v-model="statusFilter" aria-label="状态筛选" @change="load(1)">
        <option value="">全部状态</option>
        <option value="active">正常</option>
        <option value="disabled">已禁用</option>
      </select>
      <input v-model="keyword" placeholder="按昵称搜索" aria-label="昵称关键字" @keyup.enter="load(1)" />
      <button type="button" :disabled="loading" @click="load(1)">查询</button>
    </div>
  </div>
  <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="loading && !items.length" role="status">正在读取用户…</p>
  <div v-else-if="!items.length && !error" class="placeholder"><h2>暂无用户</h2><p>用户通过小程序微信登录后出现在这里。</p></div>
  <template v-else>
    <table class="data-table">
      <thead>
        <tr><th>昵称</th><th>手机号</th><th>状态</th><th>注册时间</th><th>最近登录</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="user in items" :key="user.id">
          <td>{{ user.nickname }}<small>{{ user.id }}</small></td>
          <td>{{ user.hasPhone ? user.phoneMasked : '未绑定' }}</td>
          <td><span class="badge" :class="{ warn: user.status === 'disabled' }">{{ user.status === 'active' ? '正常' : '已禁用' }}</span></td>
          <td>{{ new Date(user.createdAt).toLocaleString() }}</td>
          <td>{{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—' }}</td>
          <td class="actions"><button type="button" @click="openDetail(user)">详情</button></td>
        </tr>
      </tbody>
    </table>
    <div class="pager">
      <button type="button" :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button>
      <span>第 {{ page }} / {{ totalPages() }} 页 · 共 {{ total }} 人</span>
      <button type="button" :disabled="page >= totalPages() || loading" @click="load(page + 1)">下一页</button>
    </div>

    <div v-if="detail" class="detail-panel">
      <div class="panel-head">
        <h3>用户详情</h3>
        <button type="button" @click="detail = null; revealedPhone = null">关闭</button>
      </div>
      <dl class="detail-grid">
        <div><dt>昵称</dt><dd>{{ detail.nickname }}</dd></div>
        <div><dt>手机号</dt><dd>
          <template v-if="revealedPhone"><code class="revealed">{{ revealedPhone }}</code><small class="hint">（已记录审计）</small></template>
          <template v-else-if="detail.hasPhone">
            {{ detail.phoneMasked }}
            <button type="button" :disabled="revealing" @click="reveal(detail)">{{ revealing ? '查看中…' : '查看完整（审计）' }}</button>
          </template>
          <template v-else>未绑定</template>
        </dd></div>
        <div><dt>状态</dt><dd><span class="badge" :class="{ warn: detail.status === 'disabled' }">{{ detail.status === 'active' ? '正常' : '已禁用' }}</span></dd></div>
        <div><dt>注册时间</dt><dd>{{ new Date(detail.createdAt).toLocaleString() }}</dd></div>
        <div><dt>最近登录</dt><dd>{{ detail.lastLoginAt ? new Date(detail.lastLoginAt).toLocaleString() : '—' }}</dd></div>
      </dl>
      <div class="panel-actions">
        <button v-if="detail.status === 'active'" type="button" class="danger" :disabled="busyStatus" @click="toggleStatus(detail)">禁用账号</button>
        <button v-else type="button" class="primary" :disabled="busyStatus" @click="toggleStatus(detail)">启用账号</button>
      </div>
      <p class="hint">不提供修改用户昵称、手机号或微信身份的后台入口；身份与验证事实只能由用户本人经微信产生。</p>
    </div>
  </template>
</template>
