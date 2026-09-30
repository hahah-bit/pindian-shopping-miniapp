<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type { AdminProductView, MediaAssetView, ShareUnits, StockMovementView } from '@pindian/contracts';
import {
  ApiClientError,
  adjustStock,
  createProduct,
  formatFen,
  getAdminProduct,
  listStockMovements,
  publishProduct,
  updateProduct,
  uploadMediaAsset
} from '../../platform/api-client';
import { useRouter } from '../../platform/router';

const props = defineProps<{ productId?: string }>();
const router = useRouter();

const SHARE_OPTIONS: { units: ShareUnits; label: string }[] = [
  { units: 30, label: '1/2' },
  { units: 20, label: '1/3' },
  { units: 15, label: '1/4' },
  { units: 12, label: '1/5' }
];

interface ImageChoice {
  id: string;
  url: string;
}

const form = reactive({
  name: '',
  description: '',
  originalPriceYuan: '',
  wholeQuantity: '',
  unit: '斤',
  allowedShareUnits: [30, 20, 15, 12] as ShareUnits[],
  mainImageId: '',
  detailImages: [] as ImageChoice[],
  initialStockWholeItems: '10'
});
const stock = ref<{ availableWholeItems: number; updatedAt: string } | null>(null);
const movements = ref<StockMovementView[]>([]);
const uploadingCount = ref(0);
const uploadError = ref('');
const submitting = ref(false);
const loading = ref(false);
const error = ref('');
const notice = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const adjustForm = reactive({ mode: 'delta' as 'delta' | 'setTo', value: '', reason: '' });
const adjusting = ref(false);
const adjustError = ref('');

const isEdit = computed(() => Boolean(props.productId));
const originalPriceFen = computed(() => Math.round(Number(form.originalPriceYuan || '0') * 100));
const userWholePriceFen = computed(() => originalPriceFen.value + 500);

/** 前端参考价预览：仅展示，后端为权威（与领域公式一致 half-up）。 */
const sharePreview = computed(() => {
  const total = userWholePriceFen.value;
  return form.allowedShareUnits.map((units) => ({
    units,
    label: SHARE_OPTIONS.find((o) => o.units === units)?.label ?? '',
    priceFen: Math.floor((total * units + 30) / 60)
  }));
});

const fieldErrors = computed(() => {
  const errors: string[] = [];
  if (!form.name.trim() || form.name.trim().length > 60) errors.push('名称须为 1-60 字符');
  if (form.description.length > 2000) errors.push('介绍不能超过 2000 字');
  if (!(originalPriceFen.value >= 1 && originalPriceFen.value <= 99999999)) errors.push('原价须为 0.01 至 999999.99 元');
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(form.wholeQuantity) || Number(form.wholeQuantity) <= 0) errors.push('整件数量须为不超过 3 位小数的正数');
  if (!form.unit.trim() || form.unit.trim().length > 10) errors.push('计量单位须为 1-10 字符');
  if (form.allowedShareUnits.length === 0) errors.push('至少选择一个允许份额');
  if (!isEdit.value && !(Number(form.initialStockWholeItems) >= 0 && Number.isInteger(Number(form.initialStockWholeItems)))) errors.push('初始库存须为 0 或正整数');
  if (form.detailImages.length > 9) errors.push('详情图最多 9 张');
  return errors;
});

const canSubmit = computed(() => fieldErrors.value.length === 0 && !submitting.value && uploadingCount.value === 0);

async function loadProduct() {
  if (!props.productId) return;
  loading.value = true;
  try {
    const view = await getAdminProduct(props.productId);
    form.name = view.name;
    form.description = view.description;
    form.originalPriceYuan = (view.originalPriceFen / 100).toFixed(2);
    form.wholeQuantity = view.wholeQuantity;
    form.unit = view.unit;
    form.allowedShareUnits = [...view.allowedShareUnits];
    form.mainImageId = view.mainImage?.mediaId ?? '';
    form.detailImages = view.detailImages.map((image) => ({ id: image.mediaId, url: image.url }));
    stock.value = { availableWholeItems: view.availableWholeItems, updatedAt: view.updatedAt };
    await loadMovements();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取商品失败';
  } finally {
    loading.value = false;
  }
}

async function loadMovements() {
  if (!props.productId) return;
  try {
    const result = await listStockMovements(props.productId, 1, 10);
    movements.value = result.items;
  } catch { /* 历史加载失败不阻塞编辑 */ }
}

async function onUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  for (const file of files) {
    uploadingCount.value++;
    uploadError.value = '';
    try {
      const asset: MediaAssetView = await uploadMediaAsset(file);
      if (!form.mainImageId) form.mainImageId = asset.id;
      else if (form.detailImages.length < 9) form.detailImages.push({ id: asset.id, url: asset.url });
      else uploadError.value = '详情图最多 9 张，多出的图片保留在图片库';
    } catch (cause) {
      uploadError.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '上传失败';
    } finally {
      uploadingCount.value--;
    }
  }
}

function moveDetail(index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= form.detailImages.length) return;
  const list = [...form.detailImages];
  const current = list[index];
  const other = list[target];
  if (!current || !other) return;
  list[index] = other;
  list[target] = current;
  form.detailImages = list;
}

function removeDetail(index: number) {
  form.detailImages = form.detailImages.filter((_, i) => i !== index);
}

function toggleShare(units: ShareUnits) {
  form.allowedShareUnits = form.allowedShareUnits.includes(units)
    ? form.allowedShareUnits.filter((u) => u !== units)
    : [...form.allowedShareUnits, units].sort((a, b) => b - a);
}

async function submit() {
  if (!canSubmit.value) return;
  submitting.value = true;
  error.value = '';
  notice.value = '';
  const base = {
    name: form.name.trim(),
    description: form.description,
    originalPriceFen: originalPriceFen.value,
    wholeQuantity: form.wholeQuantity,
    unit: form.unit.trim(),
    allowedShareUnits: form.allowedShareUnits,
    mainImageId: form.mainImageId || undefined,
    detailImageIds: form.detailImages.map((image) => image.id)
  };
  try {
    if (isEdit.value && props.productId) {
      const view = await updateProduct(props.productId, base);
      notice.value = '商品已保存';
      stock.value = { availableWholeItems: view.availableWholeItems, updatedAt: view.updatedAt };
    } else {
      const view = await createProduct({ ...base, initialStockWholeItems: Number(form.initialStockWholeItems) });
      notice.value = '草稿已创建';
      router.push(`/catalog/${view.id}`);
    }
  } catch (cause) {
    error.value = cause instanceof ApiClientError
      ? (cause.details?.length ? cause.details.join('；') : `${cause.message}（${cause.code}）`)
      : '保存失败，请重试';
  } finally {
    submitting.value = false;
  }
}

async function publish() {
  if (!props.productId || submitting.value) return;
  submitting.value = true;
  error.value = '';
  notice.value = '';
  try {
    const view = await publishProduct(props.productId);
    notice.value = '商品已上架';
    stock.value = { availableWholeItems: view.availableWholeItems, updatedAt: view.updatedAt };
  } catch (cause) {
    error.value = cause instanceof ApiClientError
      ? (cause.details?.length ? `暂不能上架：${cause.details.join('；')}` : `${cause.message}（${cause.code}）`)
      : '上架失败';
  } finally {
    submitting.value = false;
  }
}

async function submitAdjust() {
  if (!props.productId || adjusting.value) return;
  const value = Number(adjustForm.value);
  const reason = adjustForm.reason.trim();
  if (!Number.isInteger(value) || (adjustForm.mode === 'delta' ? value === 0 : value < 0) || !reason) {
    adjustError.value = adjustForm.mode === 'delta' ? '增量须为非零整数' : '目标值须为不小于 0 的整数';
    if (!reason) adjustError.value += '；原因必填';
    return;
  }
  adjusting.value = true;
  adjustError.value = '';
  try {
    const result = await adjustStock(props.productId, {
      ...(adjustForm.mode === 'delta' ? { delta: value } : { setTo: value }),
      reason,
      requestId: crypto.randomUUID()
    });
    stock.value = { availableWholeItems: result.stock.availableWholeItems, updatedAt: result.stock.updatedAt };
    adjustForm.value = '';
    adjustForm.reason = '';
    notice.value = result.idempotentReplay ? '库存未变化（幂等命中）' : '库存已调整';
    await loadMovements();
  } catch (cause) {
    adjustError.value = cause instanceof ApiClientError ? `${cause.message}（${cause.code}）` : '调整失败';
  } finally {
    adjusting.value = false;
  }
}

onMounted(loadProduct);
</script>

<template>
  <div class="toolbar">
    <div>
      <h2>{{ isEdit ? '编辑商品' : '新建商品' }}</h2>
      <p>用户端整件参考价 = 原价 + 固定 5 元服务费；份额价为展示参考，正式报价在拼单开放后确定。</p>
    </div>
    <div class="controls">
      <button type="button" @click="router.push('/catalog')">返回列表</button>
    </div>
  </div>
  <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  <p v-if="error" class="error" role="alert">{{ error }}</p>
  <p v-if="loading" role="status">正在读取商品…</p>
  <div v-else class="form-grid">
    <section class="form-card">
      <h3>基础信息</h3>
      <label for="product-name">商品名称 *</label>
      <input id="product-name" v-model="form.name" maxlength="60" placeholder="如：红富士苹果" />
      <label for="product-desc">商品介绍</label>
      <textarea id="product-desc" v-model="form.description" rows="4" maxlength="2000" placeholder="产地、规格、发货说明等" />
      <div class="field-row">
        <div>
          <label for="product-price">整件原价（元）*</label>
          <input id="product-price" v-model="form.originalPriceYuan" inputmode="decimal" placeholder="500.00" />
        </div>
        <div>
          <label for="product-quantity">整件数量 *</label>
          <input id="product-quantity" v-model="form.wholeQuantity" inputmode="decimal" placeholder="10 或 9.5" />
        </div>
        <div>
          <label for="product-unit">计量单位 *</label>
          <input id="product-unit" v-model="form.unit" maxlength="10" placeholder="斤 / 箱 / 份" />
        </div>
      </div>
      <p class="hint">用户端整件参考价：<strong>¥{{ formatFen(userWholePriceFen) }}</strong>（含服务费 ¥5.00）</p>
      <h3>允许份额 *</h3>
      <div class="share-options">
        <label v-for="option in SHARE_OPTIONS" :key="option.units" class="check">
          <input type="checkbox" :checked="form.allowedShareUnits.includes(option.units)" @change="toggleShare(option.units)" />
          {{ option.label }}
        </label>
      </div>
      <table v-if="sharePreview.length" class="data-table compact">
        <thead><tr><th>份额</th><th>参考价（元）</th></tr></thead>
        <tbody><tr v-for="option in sharePreview" :key="option.units"><td>{{ option.label }}</td><td>¥{{ formatFen(option.priceFen) }}</td></tr></tbody>
      </table>
      <p class="hint">参考价四舍五入到分，仅用于展示；尾差与支付报价规则将在拼单交易任务中确定。</p>
      <label v-if="!isEdit" for="product-stock">初始整件库存 *</label>
      <input v-if="!isEdit" id="product-stock" v-model="form.initialStockWholeItems" inputmode="numeric" placeholder="10" />
    </section>

    <section class="form-card">
      <h3>商品图片</h3>
      <p class="hint">第一张上传的图片自动设为主图；详情图按顺序展示，最多 9 张。上传后可在图片库管理。</p>
      <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="onUpload" />
      <button type="button" :disabled="uploadingCount > 0" @click="fileInput?.click()">{{ uploadingCount > 0 ? `正在上传（${uploadingCount}）…` : '上传图片' }}</button>
      <p v-if="uploadError" class="error" role="alert">{{ uploadError }}</p>
      <h4>主图</h4>
      <div class="image-slot">
        <img v-if="form.mainImageId" :src="form.detailImages.find((i) => i.id === form.mainImageId)?.url ?? ''" alt="主图预览" />
        <span v-else class="badge warn">未设置（上架必需）</span>
        <button v-if="form.mainImageId" type="button" class="danger" @click="form.mainImageId = ''">移除主图</button>
      </div>
      <h4>详情图（{{ form.detailImages.length }}/9）</h4>
      <div class="image-list">
        <figure v-for="(image, index) in form.detailImages" :key="image.id" class="image-card">
          <img :src="image.url" :alt="`详情图 ${index + 1}`" loading="lazy" />
          <div class="image-actions">
            <button type="button" :disabled="index === 0" @click="moveDetail(index, -1)">←</button>
            <button type="button" :disabled="index === form.detailImages.length - 1" @click="moveDetail(index, 1)">→</button>
            <button type="button" class="danger" @click="removeDetail(index)">移除</button>
          </div>
        </figure>
      </div>
    </section>

    <section v-if="isEdit" class="form-card">
      <h3>整件库存</h3>
      <p>当前可售：<strong>{{ stock?.availableWholeItems ?? '—' }} 件</strong><span class="hint">（预占字段为未来拼单预留，当前恒为 0）</span></p>
      <div class="field-row">
        <div>
          <label for="adjust-mode">调整方式</label>
          <select id="adjust-mode" v-model="adjustForm.mode">
            <option value="delta">按增量</option>
            <option value="setTo">设为绝对值</option>
          </select>
        </div>
        <div>
          <label for="adjust-value">{{ adjustForm.mode === 'delta' ? '增量（±件）' : '目标值（件）' }}</label>
          <input id="adjust-value" v-model="adjustForm.value" inputmode="numeric" :placeholder="adjustForm.mode === 'delta' ? '-2 或 5' : '10'" />
        </div>
        <div>
          <label for="adjust-reason">原因 *</label>
          <input id="adjust-reason" v-model="adjustForm.reason" maxlength="200" placeholder="补货 / 盘点更正" />
        </div>
      </div>
      <p v-if="adjustError" class="error" role="alert">{{ adjustError }}</p>
      <button type="button" class="primary" :disabled="adjusting" @click="submitAdjust">{{ adjusting ? '调整中…' : '调整库存' }}</button>
      <h4>变动记录（最近 10 条）</h4>
      <table v-if="movements.length" class="data-table compact">
        <thead><tr><th>时间</th><th>变动</th><th>结果</th><th>原因</th></tr></thead>
        <tbody>
          <tr v-for="movement in movements" :key="movement.id">
            <td>{{ new Date(movement.createdAt).toLocaleString() }}</td>
            <td>{{ movement.delta > 0 ? `+${movement.delta}` : movement.delta }}</td>
            <td>{{ movement.resultingAvailable }}</td>
            <td>{{ movement.reason }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="hint">暂无变动记录。</p>
    </section>
  </div>
  <p v-if="fieldErrors.length" class="error" role="alert">尚需修正：{{ fieldErrors.join('；') }}</p>
  <div class="form-actions">
    <button type="button" class="primary" :disabled="!canSubmit" @click="submit">{{ submitting ? '保存中…' : (isEdit ? '保存修改' : '创建草稿') }}</button>
    <button v-if="isEdit" type="button" :disabled="submitting" @click="publish">上架 / 重新校验上架条件</button>
  </div>
</template>
