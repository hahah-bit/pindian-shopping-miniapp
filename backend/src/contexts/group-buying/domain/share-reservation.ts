import { ApplicationError } from '../../../shared/kernel';

export type ReservationStatus = 'reserved' | 'converted' | 'expired' | 'cancelled';

export interface ShareReservationState {
  reservationId: string;
  groupId: string;
  orderId: string;
  units: number;
  status: ReservationStatus;
  expiresAt: Date;
  convertedAt: Date | null;
  createdAt: Date;
}

/** 份额预占聚合根：15 分钟有效；不计入已支付；状态单向迁移。 */
export class ShareReservation {
  private constructor(readonly state: ShareReservationState) {}

  static create(input: { reservationId?: string; groupId: string; orderId: string; units: number; expiresAt: Date; now: Date }): ShareReservation {
    if (!Number.isInteger(input.units) || input.units < 1 || input.units > 30) {
      throw new ApplicationError('VALIDATION_FAILED', '预占份额单位非法');
    }
    if (!(input.expiresAt > input.now)) throw new ApplicationError('VALIDATION_FAILED', '预占有效期必须为正');
    return new ShareReservation({
      reservationId: input.reservationId ?? crypto.randomUUID(),
      groupId: input.groupId,
      orderId: input.orderId,
      units: input.units,
      status: 'reserved',
      expiresAt: input.expiresAt,
      convertedAt: null,
      createdAt: input.now
    });
  }

  static rehydrate(state: ShareReservationState): ShareReservation {
    return new ShareReservation({ ...state });
  }

  isExpired(now: Date): boolean {
    return this.state.status === 'reserved' && this.state.expiresAt.getTime() <= now.getTime();
  }

  isActive(now: Date): boolean {
    return this.state.status === 'reserved' && !this.isExpired(now);
  }

  convert(now: Date): ShareReservation {
    if (this.state.status !== 'reserved') throw new ApplicationError('VALIDATION_FAILED', '预占状态不可转换');
    return new ShareReservation({ ...this.state, status: 'converted', convertedAt: now });
  }

  expire(now: Date): ShareReservation {
    if (this.state.status === 'converted') throw new ApplicationError('VALIDATION_FAILED', '已支付预占不可过期');
    if (this.state.status !== 'reserved') return this;
    return new ShareReservation({ ...this.state, status: 'expired' });
  }

  cancel(now: Date): ShareReservation {
    if (this.state.status === 'converted') throw new ApplicationError('VALIDATION_FAILED', '已支付预占不可取消');
    if (this.state.status !== 'reserved') return this;
    return new ShareReservation({ ...this.state, status: 'cancelled' });
  }
}
