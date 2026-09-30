import type { Group } from '../domain/group';
import type { ShareReservation } from '../domain/share-reservation';

export interface GroupRepository {
  findById(groupId: string): Promise<Group | null>;
  findByIdForUpdate(groupId: string, sessionTx: unknown): Promise<Group | null>;
  findCandidates(query: { productId: string; units: number; now: Date }): Promise<Group[]>;
  insert(group: Group, sessionTx?: unknown): Promise<void>;
  save(group: Group, sessionTx?: unknown): Promise<void>;
  /** F016：到期任务扫描。 */
  findExpiredOpenGroups(now: Date, limit: number): Promise<Group[]>;
  /** F018：后台查询。 */
  listGroups(query: { status?: string | null; productId?: string | null; page: number; pageSize: number }): Promise<{ items: Group[]; total: number }>;
}

export interface ShareReservationRepository {
  insert(reservation: ShareReservation, sessionTx?: unknown): Promise<void>;
  findByOrderId(orderId: string): Promise<ShareReservation | null>;
  save(reservation: ShareReservation, sessionTx?: unknown): Promise<void>;
  /** F016：到期扫描（SKIP LOCKED 支持并发任务）。 */
  findExpired(now: Date, limit: number): Promise<ShareReservation[]>;
  /** F018：组内成员预占列表。 */
  listByGroup(groupId: string): Promise<ShareReservation[]>;
}
