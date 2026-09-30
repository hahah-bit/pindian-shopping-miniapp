import type { Address } from '../../domain/user/address';

export interface AddressRepository {
  insert(address: Address): Promise<void>;
  findById(addressId: string, userId: string): Promise<Address | null>;
  /** 行锁读取（设默认事务内使用）；仅事务会话。 */
  findByIdForUpdate?(addressId: string, userId: string, sessionTx: unknown): Promise<Address | null>;
  listByUser(userId: string): Promise<Address[]>;
  countByUser(userId: string): Promise<number>;
  update(address: Address, sessionTx?: unknown): Promise<void>;
  delete(addressId: string, userId: string): Promise<boolean>;
  clearDefaultExcept(userId: string, keepId: string, sessionTx?: unknown): Promise<void>;
}

export interface AddressSaveInput {
  receiverName: unknown;
  phone: unknown;
  province: unknown;
  city: unknown;
  district: unknown;
  detail: unknown;
}
