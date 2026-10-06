import { createAddress, updateAddress, listAddresses, ApiError, UserAuthExpiredError } from '../../../../platform/user-auth';
import type { AddressView } from '@pindian/contracts';

Page({
  data: {
    isEdit: false,
    addressId: '',
    loading: false,
    saving: false,
    error: '',
    locating: false,
    locationHint: '',
    region: [] as string[],
    form: { receiverName: '', phone: '', province: '', city: '', district: '', detail: '' }
  },

  onLoad(query: Record<string, string | undefined>) {
    if (!query.id) return;
    this.setData({ isEdit: true, addressId: query.id });
    const cached = wx.getStorageSync('pindian_edit_address') as AddressView | '' | null;
    if (cached && cached.id === query.id) {
      this.setData({
        form: {
          receiverName: cached.receiverName,
          phone: cached.phone,
          province: cached.province,
          city: cached.city,
          district: cached.district,
          detail: cached.detail
        },
        region: [cached.province, cached.city, cached.district]
      });
      wx.removeStorageSync('pindian_edit_address');
    } else {
      void this.loadFromList(query.id);
    }
  },

  async loadFromList(id: string) {
    this.setData({ loading: true });
    try {
      const result = await listAddresses();
      const found = result.items.find((item) => item.id === id);
      if (!found) {
        this.setData({ error: '地址不存在或已被删除' });
        return;
      }
      this.setData({
        form: { receiverName: found.receiverName, phone: found.phone, province: found.province, city: found.city, district: found.district, detail: found.detail },
        region: [found.province, found.city, found.district]
      });
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) wx.showToast({ title: '请先登录', icon: 'none' });
      else this.setData({ error: cause instanceof Error ? cause.message : '加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onInput(event: WechatMiniprogram.Input) {
    const field = (event.target.dataset as { field?: 'receiverName' | 'phone' | 'detail' }).field;
    if (!field) return;
    this.setData({ form: { ...this.data.form, [field]: event.detail.value } });
  },

  onRegionChange(event: WechatMiniprogram.PickerChange) {
    const value = event.detail.value as unknown;
    if (Array.isArray(value) && value.length === 3) {
      const [province, city, district] = value as [string, string, string];
      this.setData({ region: [province, city, district], form: { ...this.data.form, province, city, district } });
    }
  },

  chooseLocation() {
    if (this.data.locating || this.data.saving) return Promise.resolve();
    this.setData({locating:true, locationHint:'', error:''});
    return new Promise<void>(resolve => {
      const finish=()=>{this.setData({locating:false});resolve();};
      if (typeof wx.chooseLocation !== 'function') {
        this.setData({locationHint:'当前环境暂不支持定位，请手动填写地址'});finish();return;
      }
      wx.chooseLocation({
        success: result => {
          const address = result.address?.trim() ?? '';
          const name = result.name?.trim() ?? '';
          const detail = address.includes(name) ? address : `${address} ${name}`.trim();
          if (detail) this.setData({form:{...this.data.form,detail,province:'',city:'',district:''},region:[],locationHint:'位置已选好，请重新确认省市区，并补充楼栋、门牌号'});
          finish();
        },
        fail: error => {
          if (!error.errMsg?.includes('cancel')) this.setData({locationHint:'暂时无法获取位置。可在微信设置中允许位置权限，也可以手动填写'});
          finish();
        }
      });
    });
  },

  validate(): string {
    const { form } = this.data;
    const name = form.receiverName.trim();
    if (!name || name.length > 20) return '收货人姓名须为 1-20 个字符';
    if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) return '手机号须为 11 位大陆手机号';
    if (!form.province.trim() || !form.city.trim() || !form.district.trim()) return '请选择省市区';
    const detail = form.detail.trim();
    if (detail.length < 5 || detail.length > 120) return '详细地址须为 5-120 个字符';
    return '';
  },

  async save() {
    if (this.data.saving) return;
    const message = this.validate();
    if (message) {
      this.setData({ error: message });
      return;
    }
    this.setData({ saving: true, error: '' });
    const { form } = this.data;
    const payload = {
      receiverName: form.receiverName.trim(),
      phone: form.phone.trim(),
      province: form.province,
      city: form.city,
      district: form.district,
      detail: form.detail.trim()
    };
    try {
      if (this.data.isEdit) await updateAddress(this.data.addressId, payload);
      else await createAddress(payload);
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已新增', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (cause) {
      if (cause instanceof UserAuthExpiredError) {
        wx.showToast({ title: '请先登录', icon: 'none' });
        return;
      }
      this.setData({ error: cause instanceof ApiError || cause instanceof Error ? cause.message : '保存失败' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
