/** 运营看板读模型（T009/F037）：只读投影，金额整数分，null=无样本。口径见 T009 spec §2 / D024。 */

export interface ReportingOverviewMetrics {
  totalProducts: number;
  onShelfProducts: number;
  openGroups: number;
  successGroups: number;
  failedGroups: number;
  todayOrders: number;
  todayPaidAmountFen: number;
  serviceFeeIncomeFen: number;
  pendingRefundAmountFen: number;
  pendingShipmentCount: number;
  csPendingCount: number;
  refundRequestedFen: number;
  refundAcceptedFen: number;
  refundSucceededFen: number;
}

export interface ReportingProductMetrics {
  stockWholeItems: number;
  createdGroups: number;
  successGroups: number;
  openGroups: number;
  paidUserCount: number;
  successRate: number | null;
  avgGroupDurationMinutes: number | null;
  goodsAmountFen: number;
  serviceFeeAmountFen: number;
  refundedAmountFen: number;
}

export interface ReportingCsMetrics {
  todayConsultUsers: number;
  queuedCount: number;
  onlineAgentCount: number;
  avgFirstResponseMinutes: number | null;
  avgSessionDurationMinutes: number | null;
  unhandledCount: number;
  ticketCount: number;
  ticketResolveRate: number | null;
  ticketTypeStats: Array<{ type: string; count: number }>;
  agentLoad: Array<{ agentId: string; displayName: string; conversations: number }>;
  overdueFirstResponseCount: number;
}

/** 解析后的上海日界：[startUtc, endUtc) 与 YYYY-MM-DD 文本。 */
export interface ResolvedDay {
  date: string;
  startUtc: Date;
  endUtc: Date;
}
