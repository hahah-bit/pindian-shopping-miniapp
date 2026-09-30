import type { ContextSummary, PlatformInfo } from '@pindian/contracts';

export class DescribePlatform {
  constructor(private readonly contexts: readonly ContextSummary[]) {}

  execute(): PlatformInfo {
    return {
      name: '拼单购物平台', stage: 'foundation', backend: 'NestJS / TypeScript',
      database: 'PostgreSQL', businessReady: false,
      contexts: this.contexts.map((context) => ({ ...context }))
    };
  }
}
