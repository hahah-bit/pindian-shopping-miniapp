import type { ContextSummary } from '@pindian/contracts';

/** partial = 已有部分真实能力（T002）；planned = 仅有边界，尚未实现。 */
export const contexts: ContextSummary[] = [
  { key: 'catalog', name: '商品目录', description: '商品、份额选项、图片资源与上下架（T002 已实现）', status: 'partial' },
  { key: 'inventory', name: '整件库存', description: '整件库存设置与调整留痕；预占属后续任务', status: 'partial' },
  { key: 'group-buying', name: '拼单', description: '自动匹配、份额预占和组状态', status: 'planned' },
  { key: 'ordering', name: '交易订单', description: '下单、快照与取消资格', status: 'planned' },
  { key: 'payments', name: '支付退款', description: '微信支付、退款与对账', status: 'planned' },
  { key: 'fulfillment', name: '分份履约', description: '数量分配与独立发货', status: 'planned' },
  { key: 'identity-access', name: '身份权限', description: '后台管理员与会话权限（用户身份属后续任务）', status: 'partial' },
  { key: 'customer-service', name: '自建客服', description: '实时会话、离线留言和分配', status: 'planned' },
  { key: 'after-sales', name: '售后工单', description: '工单及售后流程协调', status: 'planned' },
  { key: 'notifications', name: '通知', description: '可靠投递与投递记录', status: 'planned' },
  { key: 'audit', name: '操作审计', description: '后台操作日志（T002 已实现基础记录）', status: 'partial' },
  { key: 'reporting', name: '基础看板', description: '业务事实的统计投影', status: 'planned' }
];
