<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template><div class="placeholder"><span class="badge">待开发</span><h2>{{ title }}</h2><p>该模块目前仅建立导航和领域边界，业务页面与接口尚未实现。</p><p>后续按 DDD → spec → plan → 实现 → 验证推进。</p></div></template>
