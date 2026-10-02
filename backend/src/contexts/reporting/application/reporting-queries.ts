import { ApplicationError } from '../../../shared/kernel';
import type { ReportingOverviewMetrics, ReportingProductMetrics, ReportingCsMetrics, ResolvedDay } from '../domain/metrics';

/** 只读投影端口：由出站适配器以 SQL 实现；不引用任何他域代码。 */
export interface ReportingReadModel {
  overviewSnapshot(day: ResolvedDay): Promise<{ overview: ReportingOverviewMetrics; product: ReportingProductMetrics }>;
  csSnapshot(day: ResolvedDay, overdueThresholdMinutes: number): Promise<ReportingCsMetrics>;
}

export interface Clock { now(): Date }

export interface ReportingQueriesOptions {
  readModel: ReportingReadModel;
  clock: Clock;
  /** D022 超时阈值（分钟），与 Worker 超时提醒任务共用配置。 */
  overdueThresholdMinutes?: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 解析 YYYY-MM-DD 为 Asia/Shanghai 自然日边界；缺省=今日。非法日期抛 VALIDATION_FAILED。 */
export function resolveShanghaiDay(input: string | undefined, clock: Clock): ResolvedDay {
  let dateText: string;
  if (input === undefined || input === '') {
    const shifted = new Date(clock.now().getTime() + 8 * 3600_000);
    dateText = shifted.toISOString().slice(0, 10);
  } else {
    if (!DATE_PATTERN.test(input)) throw new ApplicationError('VALIDATION_FAILED', 'date 必须是 YYYY-MM-DD');
    dateText = input;
  }
  const parts = dateText.split('-').map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (y === undefined || m === undefined || d === undefined) throw new ApplicationError('VALIDATION_FAILED', 'date 必须是 YYYY-MM-DD');
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    throw new ApplicationError('VALIDATION_FAILED', 'date 不是有效的日历日');
  }
  const startUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 3600_000);
  const endUtc = new Date(startUtc.getTime() + 86_400_000);
  return { date: dateText, startUtc, endUtc };
}

/** 运营看板查询用例：无状态、只读；同一请求内总览与商品基于同一快照。 */
export class ReportingQueries {
  private readonly readModel: ReportingReadModel;
  private readonly clock: Clock;
  private readonly overdueThresholdMinutes: number;

  constructor(options: ReportingQueriesOptions) {
    this.readModel = options.readModel;
    this.clock = options.clock;
    this.overdueThresholdMinutes = options.overdueThresholdMinutes ?? 15;
  }

  async overview(input: { date?: string }): Promise<{ date: string; generatedAt: string; overview: ReportingOverviewMetrics; product: ReportingProductMetrics }> {
    const day = resolveShanghaiDay(input.date, this.clock);
    const snapshot = await this.readModel.overviewSnapshot(day);
    return { date: day.date, generatedAt: this.clock.now().toISOString(), ...snapshot };
  }

  async csMetrics(input: { date?: string }): Promise<{ date: string; generatedAt: string; cs: ReportingCsMetrics }> {
    const day = resolveShanghaiDay(input.date, this.clock);
    const cs = await this.readModel.csSnapshot(day, this.overdueThresholdMinutes);
    return { date: day.date, generatedAt: this.clock.now().toISOString(), cs };
  }
}
