import {
  listAddresses,
  deleteAddress,
  setDefaultAddress,
  storedUserToken,
  UserAuthExpiredError,
  ApiError
} from '../../../../platform/user-auth';
import type { AddressView } from '@pindian/contracts';

Page({
  data: {
    loading: true,
    error: '',
    needLogin: false,
    items: [] as AddressView[],
    busyId: ''
  },

  onShow() {
    void this.load();
  },

  async load() {
    if (!storedUserToken()) {
      this.setData({ needLogin: true, loading: false, items: [] });
      return;
    }
    this.setData({ loading: true, error: '', needLogin: false });
    try {
      const result = await listAddresses();
      this.setData({ items: result.items });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) this.setData({ needLogin: true });
      else this.setData({ error: cause instanceof Error ? cause.message : '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  goLogin() {
    wx.showToast({ title: '请到“我的”页登录', icon: 'none' });
    wx.switchTab({ url: '/features/profile/pages/index/index' });
  },

  goCreate() {
    if (this.data.items.length >= 20) {
      wx.showToast({ title: '地址最多 20 条，请先删除', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/features/address/pages/form/index' });
  },

  goEdit(event: WechatMiniprogram.TouchEvent) {
    const id = (event.currentTarget.dataset as { id?: string }).id;
    const item = this.data.items.find((entry) => entry.id === id);
    if (!id || !item) return;
    wx.setStorageSync('pindian_edit_address', item);
    wx.navigateTo({ url: `/features/address/pages/form/index?id=${id}` });
  },

  async onSetDefault(event: WechatMiniprogram.TouchEvent) {
    const id = (event.currentTarget.dataset as { id?: string }).id;
    if (!id || this.data.busyId) return;
    this.setData({ busyId: id });
    try {
      const result = await setDefaultAddress(id);
      this.setData({ items: result.items });
      wx.showToast({ title: '已设为默认', icon: 'success' });
    } catch (cause) {
      this.handleError(cause);
    } finally {
      this.setData({ busyId: '' });
    }
  },

  onDelete(event: WechatMiniprogram.TouchEvent) {
    const id = (event.currentTarget.dataset as { id?: string }).id;
    if (!id || this.data.busyId) return;
    wx.showModal({
      title: '删除地址',
      content: '删除后不可恢复，确定删除该收货地址？',
      success: (modal) => {
        if (!modal.confirm) return;
        void this.doDelete(id);
      }
    });
  },

  async doDelete(id: string) {
    this.setData({ busyId: id });
    try {
      await deleteAddress(id);
      await this.load();
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (cause) {
      this.handleError(cause);
    } finally {
      this.setData({ busyId: '' });
    }
  },

  handleError(cause: unknown) {
    if (cause instanceof UserAuthExpiredError) this.setData({ needLogin: true, items: [] });
    else wx.showToast({ title: cause instanceof ApiError || cause instanceof Error ? cause.message : '操作失败', icon: 'none' });
  },

  retry() {
    void this.load();
  }
});
