import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

type BoundStatement = {
  readonly statement: string;
  readonly values: unknown[];
  bind(...values: unknown[]): BoundStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<D1Result>;
};

export type SitesDatabase = {
  prepare(statement: string): BoundStatement;
  batch<T = Record<string, unknown>>(statements: BoundStatement[]): Promise<Array<D1Result & { results: T[] }>>;
};

function toDrizzleQuery(statement: string, values: unknown[]) {
  const query = sql.empty();
  let chunkStart = 0;
  let valueIndex = 0;
  let quote: "'" | '"' | "`" | null = null;

  for (let index = 0; index < statement.length; index += 1) {
    const char = statement[index];
    if (quote) {
      if (char === quote) {
        if (statement[index + 1] === quote) index += 1;
        else quote = null;
      } else if (char === "\\" && index + 1 < statement.length) {
        index += 1;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char !== "?") continue;

    if (valueIndex >= values.length) {
      throw new Error("Database query is missing a bound value.");
    }
    query.append(sql.raw(statement.slice(chunkStart, index)));
    query.append(sql`${values[valueIndex]}`);
    valueIndex += 1;
    chunkStart = index + 1;
  }

  if (valueIndex !== values.length) {
    throw new Error("Database query has more bound values than placeholders.");
  }
  query.append(sql.raw(statement.slice(chunkStart)));
  return query;
}

class DrizzleSitesDatabase implements SitesDatabase {
  private readonly orm: DrizzleClient;

  constructor(private readonly binding: D1Database) {
    this.orm = drizzle(binding, { schema });
  }

  prepare(statement: string): BoundStatement {
    const createStatement = (values: unknown[]): BoundStatement => ({
      statement,
      values,
      bind: (...nextValues) => createStatement(nextValues),
      first: async <T = Record<string, unknown>>() =>
        (await this.orm.get<T>(toDrizzleQuery(statement, values))) ?? null,
      all: async <T = Record<string, unknown>>() => ({
        results: (await this.orm.all(toDrizzleQuery(statement, values))) as T[],
      }),
      run: async () => this.orm.run(toDrizzleQuery(statement, values)),
    });
    return createStatement([]);
  }

  async batch<T = Record<string, unknown>>(statements: BoundStatement[]) {
    // Drizzle's D1 batch API expects Drizzle prepared queries. Preserve D1's
    // atomic batch for the few multi-write workflows that still use this shim.
    return await this.binding.batch(
      statements.map(({ statement, values }) =>
        this.binding.prepare(statement).bind(...values),
      ),
    ) as Array<D1Result & { results: T[] }>;
  }
}

export function getDb(): SitesDatabase {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return new DrizzleSitesDatabase(env.DB);
}
