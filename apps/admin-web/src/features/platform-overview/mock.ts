import type { PlatformInfo } from '@pindian/contracts';

export const mockPlatform: PlatformInfo = {
  name: '拼单购物平台', stage: 'foundation', backend: 'NestJS / TypeScript', database: 'PostgreSQL', businessReady: false,
  contexts: [
    ['catalog', '商品目录', '商品发布、规格与销售规则'], ['inventory', '整件库存', '整件预留、消耗和释放'],
    ['group-buying', '拼单', '自动匹配、份额预占和组状态'], ['ordering', '交易订单', '下单、快照与取消资格'],
    ['payments', '支付退款', '支付、退款与对账'], ['fulfillment', '分份履约', '数量分配与独立发货'],
    ['identity-access', '身份权限', '用户、地址和角色'], ['customer-service', '自建客服', '会话、留言与分配'],
    ['after-sales', '售后工单', '工单与售后流程'], ['notifications', '通知', '投递记录'],
    ['audit', '操作审计', '管理员操作记录'], ['reporting', '基础看板', '统计查询投影']
  ].map(([key, name, description]) => ({ key: key!, name: name!, description: description!, status: 'planned' }))
};
