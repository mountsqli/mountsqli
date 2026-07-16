// MountSQLI — Next.js DB client singleton.

import "@mountsqli/driver-postgres";
import { mountsqliFull, type DbFromConfig } from "@mountsqli/core";
import config from "../../mountsqli.config";

let cached: DbFromConfig<typeof config> | null = null;

export async function getDb(): Promise<DbFromConfig<typeof config>> {
  if (cached) return cached;
  const {db} = await mountsqliFull(config);
  cached = db;
  return cached;
}


export { sql, eq, ne, gt, gte, lt, lte, like, inArray, isNull, and, or } from "@mountsqli/core";
