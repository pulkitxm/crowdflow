declare module 'bun:sqlite' {
  export class Statement<Result, Parameters extends unknown[]> {
    get(...parameters: Parameters): Result | null;
    all(...parameters: Parameters): Result[];
  }

  export class Database {
    constructor(path: string, options?: { create?: boolean; strict?: boolean });
    exec(sql: string): void;
    run(sql: string, ...parameters: unknown[]): void;
    query<Result, Parameters extends unknown[]>(sql: string): Statement<Result, Parameters>;
    close(): void;
  }
}
