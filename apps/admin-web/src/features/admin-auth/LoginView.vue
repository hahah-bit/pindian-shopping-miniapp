<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiClientError, login, storeToken } from '../../platform/api-client';

const emit = defineEmits<{ (event: 'authenticated', payload: { token: string; displayName: string }): void }>();

const username = ref('');
const password = ref('');
const submitting = ref(false);
const error = ref('');

const usernameValid = computed(() => /^[a-z0-9_-]{3,32}$/.test(username.value.trim()));
const canSubmit = computed(() => usernameValid.value && password.value.length >= 6 && !submitting.value);

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = '';
  try {
    const result = await login(username.value.trim(), password.value);
    storeToken(result.token);
    emit('authenticated', { token: result.token, displayName: result.admin.displayName });
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      if (cause.code === 'RATE_LIMITED') error.value = cause.message;
      else if (cause.code === 'UNAUTHENTICATED') error.value = '用户名或密码不正确';
      else error.value = `${cause.message}（${cause.code}）`;
    } else {
      error.value = '无法连接后端，请确认 API 已启动';
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <form class="login-card" @submit.prevent="submit">
      <div class="brand-mark big">拼</div>
      <h2>拼单平台 · 管理后台</h2>
      <p>请使用管理员账号登录。连续失败多次会被临时锁定。</p>
      <label for="login-username">用户名</label>
      <input id="login-username" v-model="username" autocomplete="username" placeholder="小写字母、数字、- 或 _" :aria-invalid="username.length > 0 && !usernameValid" />
      <label for="login-password">密码</label>
      <input id="login-password" v-model="password" type="password" autocomplete="current-password" placeholder="至少 6 位" />
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="!canSubmit">{{ submitting ? '正在登录…' : '登录' }}</button>
      <small>凭据由初始管理员流程提供，不在本页或源码中保存。</small>
    </form>
  </div>
</template>
