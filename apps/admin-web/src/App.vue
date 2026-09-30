<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { AdminProfile } from '@pindian/contracts';
import PlatformOverview from './features/platform-overview/PlatformOverview.vue';
import ModulePlaceholder from './features/module-placeholder/ModulePlaceholder.vue';
import LoginView from './features/admin-auth/LoginView.vue';
import ProductListView from './features/product-admin/ProductListView.vue';
import ProductFormView from './features/product-admin/ProductFormView.vue';
import MediaLibraryView from './features/media/MediaLibraryView.vue';
import AdminUsersView from './features/admin-users/AdminUsersView.vue';
import { currentPath, navigate } from './platform/router';
import { ApiClientError, fetchMe, logout, storedToken, storeToken } from './platform/api-client';

const navigation = [
  { key: 'platform', label: '框架概览', path: '/platform' },
  { key: 'catalog', label: '商品与库存', path: '/catalog' },
  { key: 'media', label: '图片库', path: '/media' },
  { key: 'orders', label: '拼单与订单', path: '/orders' },
  { key: 'payments', label: '支付与退款', path: '/payments' },
  { key: 'fulfillment', label: '分份履约', path: '/fulfillment' },
  { key: 'customer-service', label: '客服工作台', path: '/customer-service' },
  { key: 'after-sales', label: '售后工单', path: '/after-sales' },
  { key: 'reporting', label: '运营看板', path: '/reporting' },
  { key: 'users', label: '用户管理', path: '/users' },
  { key: 'access', label: '权限与审计', path: '/access' }
];

const admin = ref<AdminProfile | null>(null);
const authChecking = ref(true);
const authError = ref('');
const loggingOut = ref(false);

/** 登录路由本身不需要认证；其余路由无有效会话时回到登录页。 */
const isLoginRoute = computed(() => currentPath.value === '/login');
const requiresAuth = computed(() => !isLoginRoute.value);

async function restoreSession() {
  authChecking.value = true;
  authError.value = '';
  if (!storedToken()) {
    admin.value = null;
    authChecking.value = false;
    if (requiresAuth.value) navigate('/login');
    return;
  }
  try {
    admin.value = await fetchMe();
  } catch (cause) {
    admin.value = null;
    storeToken(null);
    if (cause instanceof ApiClientError && cause.code === 'UNAUTHENTICATED') {
      if (requiresAuth.value) navigate('/login');
    } else {
      authError.value = cause instanceof Error ? cause.message : '无法连接后端';
      if (requiresAuth.value) navigate('/login');
    }
  } finally {
    authChecking.value = false;
  }
}

function onAuthenticated(payload: { token: string; displayName: string }) {
  admin.value = { id: '', username: '', displayName: payload.displayName, role: 'super_admin', permissions: [] };
  navigate('/catalog');
  void restoreSession();
}

async function signOut() {
  if (loggingOut.value) return;
  loggingOut.value = true;
  await logout();
  storeToken(null);
  admin.value = null;
  loggingOut.value = false;
  navigate('/login');
}

watch(currentPath, (path) => {
  if (path !== '/login' && !admin.value && !authChecking.value) void restoreSession();
});

const title = computed(() => navigation.find((item) => currentPath.value.startsWith(item.path))?.label ?? '管理后台');
const activeNavKey = computed(() => navigation.find((item) => currentPath.value.startsWith(item.path))?.key ?? 'platform');
const productIdFromRoute = computed(() => {
  const match = currentPath.value.match(/^\/catalog\/([0-9a-f-]{36})$/i);
  return match?.[1];
});

const onHashChange = () => { /* currentPath 由 router 模块维护 */ };
window.addEventListener('hashchange', onHashChange);
onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange));
onMounted(restoreSession);
</script>

<template>
  <LoginView v-if="!authChecking && !admin" @authenticated="onAuthenticated" />
  <div v-else-if="authChecking" class="auth-loading"><p>正在恢复登录状态…</p></div>
  <div v-else class="layout">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">拼</span><div><strong>拼单平台</strong><small>管理后台 · T002</small></div></div>
      <nav aria-label="管理模块">
        <a v-for="item in navigation" :key="item.key" :href="`#${item.path}`" :class="{ active: activeNavKey === item.key }" :aria-current="activeNavKey === item.key ? 'page' : undefined">{{ item.label }}</a>
      </nav>
      <div class="sidebar-note">
        <template v-if="admin">{{ admin.displayName }}（{{ admin.role === 'super_admin' ? '超级管理员' : admin.role }}）<br /><button type="button" class="link-button" :disabled="loggingOut" @click="signOut">{{ loggingOut ? '正在登出…' : '退出登录' }}</button></template>
        <template v-else>&nbsp;</template>
      </div>
    </aside>
    <main>
      <header>
        <span>平台管理 / {{ title }}</span>
        <span class="badge">T002 商品与图片管理</span>
      </header>
      <section class="content">
        <p v-if="authError" class="error" role="alert">{{ authError }}。请确认 API 已启动后<a href="#/login">重新登录</a>。</p>
        <PlatformOverview v-if="currentPath === '/platform'" />
        <ProductListView v-else-if="currentPath === '/catalog'" />
        <ProductFormView v-else-if="currentPath === '/catalog/new'" />
        <ProductFormView v-else-if="productIdFromRoute" :product-id="productIdFromRoute" />
        <MediaLibraryView v-else-if="currentPath === '/media'" />
        <AdminUsersView v-else-if="currentPath === '/users'" />
        <ModulePlaceholder v-else :title="title" />
      </section>
    </main>
  </div>
</template>
