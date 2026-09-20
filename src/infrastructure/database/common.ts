export function now(): string {
  return new Date().toISOString();
}

export function entityId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export type DatabaseRow = Record<string, unknown>;
