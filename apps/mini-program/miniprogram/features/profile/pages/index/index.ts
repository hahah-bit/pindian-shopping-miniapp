import {
  fetchCurrentUser,
  loginWithWechat,
  logoutCurrentUser,
  updateNickname,
  bindPhoneNumber,
  UserAuthExpiredError
} from '../../../../platform/user-auth';
import { apiConfig } from '../../../../platform/config';
import { fetchUnreadCount } from '../../../../platform/notification-api';
import type { MiniUserView } from '@pindian/contracts';

Page({
  data: {
    source: apiConfig.mode === 'mock' ? 'Mock 数据预览' : '真实后端数据',
    isMock: apiConfig.mode === 'mock',
    loading: false,
    loggingIn: false,
    error: '',
    user: null as MiniUserView | null,
    editingNickname: false,
    nicknameInput: '',
    savingNickname: false,
    bindingPhone: false,
    unreadCount: 0,
    joinedDate: ''
  },

  onShow() {
    void this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const user = await fetchCurrentUser();
      const unreadCount = await fetchUnreadCount();
      this.setData({ user, unreadCount, joinedDate: user?.createdAt.slice(0,10) ?? '' });
    } catch (cause) {
      this.setData({ error: cause instanceof Error ? cause.message : '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async login() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true, error: '' });
    try {
      const result = await loginWithWechat();
      this.setData({ user: { ...result.user, phoneVerified: result.user.phoneVerified },joinedDate:result.user.createdAt.slice(0,10) });
      wx.showToast({ title: result.isNewUser ? '登录成功，欢迎' : '欢迎回来', icon: 'success' });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '登录失败';
      this.setData({ error: message });
    } finally {
      this.setData({ loggingIn: false });
    }
  },

  openNotifications() {
    wx.navigateTo({ url: '/features/notifications/pages/index/index' });
  },

  startEditNickname() {
    if (!this.data.user) return;
    this.setData({ editingNickname: true, nicknameInput: this.data.user.nickname, error: '' });
  },

  onNicknameInput(event: WechatMiniprogram.Input) {
    this.setData({ nicknameInput: event.detail.value });
  },

  cancelEditNickname() {
    this.setData({ editingNickname: false, nicknameInput: '' });
  },

  async saveNickname() {
    if (this.data.savingNickname) return;
    const nickname = this.data.nicknameInput.trim();
    if (!nickname || nickname.length > 30) {
      this.setData({ error: '昵称须为 1-30 个字符' });
      return;
    }
    this.setData({ savingNickname: true, error: '' });
    try {
      const user = await updateNickname(nickname);
      this.setData({ user, editingNickname: false, nicknameInput: '' });
      wx.showToast({ title: '已保存', icon: 'success' });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) {
        this.setData({ user: null, editingNickname: false });
      }
      this.setData({ error: cause instanceof Error ? cause.message : '保存失败' });
    } finally {
      this.setData({ savingNickname: false });
    }
  },

  /** 手机号授权回调：仅取 code 交后端验证；拒绝授权给出明确提示。 */
  async onGetPhoneNumber(event: WechatMiniprogram.CustomEvent<{ errMsg?: string; code?: string }>) {
    if (this.data.bindingPhone) return;
    const detail = event.detail ?? {};
    if (!detail.code || (detail.errMsg && detail.errMsg.includes('deny')) || (detail.errMsg && detail.errMsg.includes('fail'))) {
      wx.showToast({ title: '未授权手机号', icon: 'none' });
      return;
    }
    this.setData({ bindingPhone: true, error: '' });
    try {
      const result = await bindPhoneNumber(detail.code);
      if (this.data.user) {
        this.setData({ user: { ...this.data.user, hasPhone: true, phoneMasked: result.phoneMasked, phoneVerified: true } });
      }
      wx.showToast({ title: '手机号已绑定', icon: 'success' });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) {
        this.setData({ user: null });
      }
      this.setData({ error: cause instanceof Error ? cause.message : '绑定失败' });
    } finally {
      this.setData({ bindingPhone: false });
    }
  },

  openSupport() { wx.navigateTo({url:'/features/cs/pages/index/index'}); },

  openAddresses() {
    if (!this.data.user) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/features/address/pages/list/index' });
  },

  async signOut() {
    try {
      await logoutCurrentUser();
    } catch (cause) {
      void cause; // 本地态总是清除
    }
    this.setData({ user: null, error: '' });
    wx.showToast({ title: '已退出登录', icon: 'none' });
  },

  retry() {
    void this.load();
  }
});
