import type { ApiResponse, PlatformInfo } from '@pindian/contracts';
import { apiConfig } from './config';

const mock: PlatformInfo = {
  name: '拼单购物平台', stage: 'foundation', backend: 'NestJS / TypeScript', database: 'PostgreSQL', businessReady: false,
  contexts: [
    { key: 'catalog', name: '商品与库存', description: '商品发布与整件库存', status: 'planned' },
    { key: 'group-buying', name: '拼单交易', description: '份额、匹配与订单', status: 'planned' },
    { key: 'payments', name: '支付退款', description: '真实支付尚未接入', status: 'planned' },
    { key: 'customer-service', name: '客服与售后', description: '会话、留言和工单', status: 'planned' }
  ]
};

export async function getPlatform(): Promise<PlatformInfo> {
  if (apiConfig.mode === 'mock') return mock;
  return new Promise((resolve, reject) => {
    wx.request<ApiResponse<PlatformInfo>>({
      url: `${apiConfig.baseUrl}/api/mini/v1/platform`, timeout: 5000,
      success(response) {
        if (response.statusCode !== 200 || response.data?.data?.stage !== 'foundation' || response.data.data.businessReady !== false || !Array.isArray(response.data.data.contexts)) {
          reject(new Error('框架接口暂不可用或返回数据无效'));
        } else resolve(response.data.data);
      },
      fail() { reject(new Error('无法连接 API，请检查地址和开发者工具网络配置')); }
    });
  });
}
