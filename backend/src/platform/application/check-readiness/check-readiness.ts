import type { DatabaseProbe } from '../ports/database-probe';

export class CheckReadiness {
  constructor(private readonly database: DatabaseProbe) {}

  async execute(): Promise<boolean> {
    try {
      await this.database.ping();
      return true;
    } catch {
      return false;
    }
  }
}
