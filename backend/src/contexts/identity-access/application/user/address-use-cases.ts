import { ApplicationError, SystemClock, type Clock } from '../../../../shared/kernel';
import { Address, ADDRESS_LIMIT_PER_USER } from '../../domain/user/address';
import type { UserRepository } from './user-ports';
import type { AddressRepository, AddressSaveInput } from './address-ports';

function toView(address: Address) {
  return {
    id: address.state.addressId,
    receiverName: address.state.receiverName,
    phone: address.state.phone,
    province: address.state.province,
    city: address.state.city,
    district: address.state.district,
    detail: address.state.detail,
    isDefault: address.state.isDefault,
    createdAt: address.state.createdAt,
    updatedAt: address.state.updatedAt
  };
}

async function requireOwned(addresses: AddressRepository, userId: unknown, addressId: unknown): Promise<Address> {
  if (typeof userId !== 'string' || !userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
  if (typeof addressId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(addressId)) {
    throw new ApplicationError('NOT_FOUND', '地址不存在');
  }
  const address = await addresses.findById(addressId, userId);
  if (!address) throw new ApplicationError('NOT_FOUND', '地址不存在');
  return address;
}

export class ListMyAddresses {
  constructor(private readonly deps: { addresses: AddressRepository }) {}

  async execute(input: { userId: unknown }): Promise<{ items: ReturnType<typeof toView>[] }> {
    if (typeof input.userId !== 'string' || !input.userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const items = await this.deps.addresses.listByUser(input.userId);
    return { items: items.map(toView) };
  }
}

export class CreateAddress {
  private readonly clock: Clock;
  constructor(deps: { addresses: AddressRepository; clock?: Clock }) {
    this.addresses = deps.addresses;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly addresses: AddressRepository;

  async execute(input: { userId: unknown; input: AddressSaveInput }) {
    if (typeof input.userId !== 'string' || !input.userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    const count = await this.addresses.countByUser(input.userId);
    if (count >= ADDRESS_LIMIT_PER_USER) {
      throw new ApplicationError('ADDRESS_LIMIT_REACHED', `收货地址最多 ${ADDRESS_LIMIT_PER_USER} 条，请先删除不需要的地址`);
    }
    const address = Address.create({ userId: input.userId, ...input.input, now: this.clock.now() });
    await this.addresses.insert(address);
    return toView(address);
  }
}

export class UpdateAddress {
  private readonly clock: Clock;
  constructor(deps: { addresses: AddressRepository; clock?: Clock }) {
    this.addresses = deps.addresses;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly addresses: AddressRepository;

  async execute(input: { userId: unknown; addressId: unknown; input: AddressSaveInput }) {
    const address = await requireOwned(this.addresses, input.userId, input.addressId);
    const updated = address.relocate(input.input, this.clock.now());
    await this.addresses.update(updated);
    return toView(updated);
  }
}

export class DeleteAddress {
  private readonly clock: Clock;
  constructor(deps: { addresses: AddressRepository; clock?: Clock }) {
    this.addresses = deps.addresses;
    this.clock = deps.clock ?? new SystemClock();
  }
  private readonly addresses: AddressRepository;

  async execute(input: { userId: unknown; addressId: unknown }): Promise<{ deleted: true }> {
    const address = await requireOwned(this.addresses, input.userId, input.addressId);
    const deleted = await this.addresses.delete(address.state.addressId, address.state.userId);
    if (!deleted) throw new ApplicationError('NOT_FOUND', '地址不存在');
    return { deleted: true };
  }
}

/**
 * 设默认（幂等）：事务内先锁用户行（串行化同用户的默认切换，避免并发死锁），
 * 再清其他默认、置目标默认；部分唯一索引 UNIQ(user_id) WHERE is_default 为最终防线。
 */
export class SetDefaultAddress {
  constructor(private readonly deps: { addresses: AddressRepository; users?: UserRepository; runner?: { run<T>(work: (sessionTx: unknown) => Promise<T>): Promise<T> } }) {}

  async execute(input: { userId: unknown; addressId: unknown }): Promise<{ items: ReturnType<typeof toView>[] }> {
    const userId = typeof input.userId === 'string' && input.userId ? input.userId : '';
    if (!userId) throw new ApplicationError('UNAUTHENTICATED', '访问凭证无效或已过期');
    if (typeof input.addressId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.addressId)) {
      throw new ApplicationError('NOT_FOUND', '地址不存在');
    }
    const owned = await this.deps.addresses.findById(input.addressId, userId);
    if (!owned) throw new ApplicationError('NOT_FOUND', '地址不存在');

    const applyDefault = async (): Promise<void> => {
      if (this.deps.runner && this.deps.users?.lockById) {
        await this.deps.runner.run(async (sessionTx) => {
          await this.deps.users!.lockById!(userId, sessionTx);
          await this.deps.addresses.clearDefaultExcept(userId, owned.state.addressId, sessionTx);
          await this.deps.addresses.update(owned.withDefault(true), sessionTx);
        });
      } else {
        await this.deps.addresses.clearDefaultExcept(userId, owned.state.addressId);
        await this.deps.addresses.update(owned.withDefault(true));
      }
    };
    await applyDefault();
    const items = await this.deps.addresses.listByUser(userId);
    return { items: items.map(toView) };
  }
}
