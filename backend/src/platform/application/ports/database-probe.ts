export interface DatabaseProbe {
  ping(): Promise<void>;
}

export const DATABASE_PROBE = Symbol('DATABASE_PROBE');
