/** 退款查询投影依赖（ Payments 后台查询）。 */
export interface RefundQueriesDeps {
  refunds: { listAdmin(query: { status?: string | null; page: number; pageSize: number }): Promise<{ items: unknown[]; total: number }> };
  nicknameOf: (userId: string) => Promise<string>;
}
