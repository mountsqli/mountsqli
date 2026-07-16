// MountSQLI — fluent, immutable, type-safe query builder + `sql` tag.
// Each chained method returns a NEW builder (structural sharing of the
// plan object) so calls are cheap and side-effect free.

import { compilePlan, emptyPlan, getDialect, type Comparator, type QueryPlan, type FilterNode, type Dialect, type WindowDef, type OnConflict, type FtsDef, type JsonOp, type AggregateDef } from "@mountsqli/compiler";
import { MountError, type Compiled, type ExecuteMode, type QueryResult, type Driver, type Transaction } from "@mountsqli/driver";
import type { Table } from "@mountsqli/schema";

type Row<T extends Table<any>> = T extends Table<infer C> ? T["__row"] : never;

/**
 * Pick a subset of columns from a row type. Used by `.select('a','b')`.
 */
type PickRow<T extends Table<any>, K extends keyof Row<T>> = {
  [P in K]: Row<T>[P];
};

/** Extract column names from Row<T> that are assignable to string. */
type StringKeyOf<T> = Extract<keyof T, string>;

export class QueryBuilder<T extends Table<any>> {
  /** Resolved dialect matching the driver's name. */
  protected dialect: Dialect;

  constructor(
    protected driver: Driver,
    protected table: T,
    protected plan: QueryPlan = emptyPlan(table.__name),
    /** All registered tables (used by findMany to resolve relations). */
    protected allTables?: any[],
  ) {
    // Resolve the correct dialect from the driver name so that all
    // compilePlan calls use the right quoting, param style, and types.
    this.dialect = getDialect(driver.name);
    // carry column type info so the driver can decode (e.g. bool 0/1 -> true/false)
    if (!plan.columnTypes) {
      const ct: Record<string, any> = {};
      for (const [name, builder] of Object.entries(table.__cols)) {
        ct[name] = (builder as any).def.type;
      }
      this.plan.columnTypes = ct;
    }
  }

  protected fork(patch: Partial<QueryPlan>): QueryBuilder<T> {
    return new QueryBuilder(this.driver, this.table, { ...this.plan, ...patch }, this.allTables);
  }

  where<K extends StringKeyOf<Row<T>>>(
    column: K,
    op: Comparator,
    value: Row<T>[K] | Row<T>[K][],
  ): QueryBuilder<T>;
  where(filter: FilterNode): QueryBuilder<T>;
  where(colOrFilter: any, op?: Comparator, value?: any): QueryBuilder<T> {
    const filter: FilterNode = typeof colOrFilter === "object" && colOrFilter !== null && "kind" in colOrFilter
      ? colOrFilter
      : { kind: "filter", column: colOrFilter as string, op: op as Comparator, value } as any;
    return this.fork({
      filters: [...this.plan.filters, filter],
    });
  }

  orderBy<K extends StringKeyOf<Row<T>>>(column: K, dir: "asc" | "desc" = "asc"): QueryBuilder<T> {
    return this.fork({ orderBy: [...(this.plan.orderBy ?? []), { column, dir }] });
  }

  limit(n: number): QueryBuilder<T> {
    return this.fork({ limit: n });
  }

  offset(n: number): QueryBuilder<T> {
    return this.fork({ offset: n });
  }

  /** SELECT DISTINCT — deduplicates result rows. */
  distinct(): QueryBuilder<T> {
    return this.fork({ distinct: true });
  }

  /** Postgres DISTINCT ON (columns). Implies DISTINCT. */
  distinctOn<K extends StringKeyOf<Row<T>>>(...columns: K[]): QueryBuilder<T> {
    return this.fork({ distinctOn: columns as string[] });
  }

  /** GROUP BY — group rows by one or more columns. */
  groupBy<K extends StringKeyOf<Row<T>>>(...columns: K[]): QueryBuilder<T> {
    return this.fork({ groupBy: columns as string[] });
  }

  /** HAVING — filter after GROUP BY (same structure as WHERE). */
  having(column: string, op: Comparator, value: unknown): QueryBuilder<T> {
    const having: FilterNode[] = [
      ...(this.plan.having ?? []),
      { kind: "filter", column, op, value } as any,
    ];
    return this.fork({ having });
  }

  /**
   * Inject raw FilterNode[] into the plan. Used by the RLS policy engine
   * (`@mountsqli/auth`) to push row-level-security predicates down to the
   * SQL layer. Returns a new immutable builder (structural sharing).
   */
  withFilters(filters: FilterNode[]): QueryBuilder<T> {
    if (filters.length === 0) return this;
    return this.fork({ filters: [...this.plan.filters, ...filters] });
  }

  /**
   * Opt out of RLS enforcement for this builder. Only meaningful when the
   * enclosing `Db` runs in `enforceRls` mode — bypasses the
   * "policy must be applied before execute" guard (issue 003). Use sparingly
   * and only for queries that are provably safe (e.g. admin, aggregates).
   */
  unsafe(): QueryBuilder<T> {
    return this.fork({ rlsUnsafe: true });
  }

  /** Mark this builder as having had its RLS policy applied (issue 003).
   * Called by `applyPolicy`/`applyPolicies`; not for general use. */
  withRlsApplied(): QueryBuilder<T> {
    return this.fork({ rlsApplied: true });
  }

  /**
   * Add a JOIN clause. E.g. `.join("posts", "inner", "id", "user_id")`
   * produces `JOIN "posts" ON "users"."id" = "posts"."user_id"`.
   *
   * For self-joins, pass an alias:
   * `.join("users", "left", "manager_id", "id", "managers")`
   * → `LEFT JOIN "users" AS "managers" ON "users"."manager_id" = "users"."id"`
   */
  join(table: string, type: "inner" | "left" | "right", leftCol: string, rightCol: string, alias?: string): QueryBuilder<T> {
    const join: import("@mountsqli/compiler").JoinDef = { type, table, alias, on: { left: leftCol, right: rightCol } };
    return this.fork({ joins: [...(this.plan.joins ?? []), join] });
  }

  /**
   * Convenience: add a JOIN from a schema relationship definition.
   * `withRelations("author")` resolves the `belongsTo`/`hasMany` from the
   * table's `relations` array and adds the appropriate JOIN.
   */
  withRelations(name: string, type: "inner" | "left" = "left"): QueryBuilder<T> {
    const rels = (this.table as any).relations as import("@mountsqli/schema").RelationshipDef[] | undefined;
    if (!rels) return this;
    const rel = rels.find((r: any) => r.name === name);
    if (!rel) throw new MountError("VALIDATION", `MountSQLI: relationship "${name}" not found on table "${this.table.__name}". Define it in the table's \`relations\` option.`);
    if (rel.kind === "belongsTo") {
      return this.join(rel.targetTable, type, `${this.table.__name}.${rel.foreignKey}`, `${rel.targetTable}.${rel.localKey}`);
    }
    if (rel.kind === "hasMany" || rel.kind === "hasOne") {
      return this.join(rel.targetTable, type, `${this.table.__name}.${rel.localKey}`, `${rel.targetTable}.${rel.foreignKey}`);
    }
    return this;
  }

  /** Force the query to match nothing (RLS explicit deny). */
  deny(): QueryBuilder<T> {
    return this.fork({ deny: true });
  }

  // ---- Set operations ----

  /** Append INTERSECT with another query. */
  intersect<T2 extends Table<any>>(qb: QueryBuilder<T2>): QueryBuilder<T> {
    return this.fork({
      unions: [...(this.plan.unions ?? []), { type: "intersect" as const, query: qb._plan }],
    });
  }
  /** Append EXCEPT (MINUS) with another query. */
  except<T2 extends Table<any>>(qb: QueryBuilder<T2>): QueryBuilder<T> {
    return this.fork({
      unions: [...(this.plan.unions ?? []), { type: "except" as const, query: qb._plan }],
    });
  }
  /** Append UNION (deduplicated) with another query. */
  union<T2 extends Table<any>>(qb: QueryBuilder<T2>): QueryBuilder<T> {
    return this.fork({
      unions: [...(this.plan.unions ?? []), { type: "union" as const, query: qb._plan }],
    });
  }
  /** Append UNION ALL with another query. */
  unionAll<T2 extends Table<any>>(qb: QueryBuilder<T2>): QueryBuilder<T> {
    return this.fork({
      unions: [...(this.plan.unions ?? []), { type: "union all" as const, query: qb._plan }],
    });
  }

  /**
   * Use a subquery as the FROM source.
   * ```ts
   * const sub = db.query(posts).groupBy("author_id");
   * const q = db.query(users).subquery(sub, "post_counts").select();
   * // SELECT * FROM (SELECT * FROM posts GROUP BY author_id) AS "post_counts"
   * ```
   */
  subquery(qb: QueryBuilder<any>, alias: string): QueryBuilder<T> {
    return this.fork({ fromSubquery: { plan: qb._plan, alias } });
  }

  /**
   * Add a CTE (Common Table Expression) to the query.
   * ```ts
   * const cte = db.query(users).where("age", ">", 18);
   * const q = db.query(users).with("adults", cte).select("id", "name");
   * // WITH "adults" AS (SELECT * FROM "users" WHERE "age" > ?) SELECT "id", "name" FROM "users"
   * ```
   */
  with(name: string, qb: QueryBuilder<any>, columns?: string[]): QueryBuilder<T> {
    return this.fork({
      with: [...(this.plan.with ?? []), { name, columns, query: qb._plan }],
    });
  }

  // ---------------------------------------------------------------------------
  // Window functions
  // ---------------------------------------------------------------------------

  /**
   * Add a window function to the SELECT clause.
   * ```ts
   * db.query(posts).window("row_number", { partitionBy: ["author_id"], orderBy: ["created_at"] }, "rn")
   * ```
   */
  window(fn: WindowDef["fn"], opts: { column?: string; partitionBy?: string[]; orderBy?: { column: string; dir?: "asc" | "desc" }[]; frame?: string }, alias: string): QueryBuilder<T> {
    const orderBy = opts.orderBy?.map((o) => ({ column: o.column, dir: o.dir ?? "asc" }));
    const def: WindowDef = { fn, alias, column: opts.column, partitionBy: opts.partitionBy, orderBy, frame: opts.frame };
    return this.fork({ window: [...(this.plan.window ?? []), def] });
  }

  /** Shorthand: ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...). */
  rowNumber(alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("row_number", { partitionBy, orderBy }, alias);
  }

  /** Shorthand: RANK() OVER (...). */
  rank(alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("rank", { partitionBy, orderBy }, alias);
  }

  /** Shorthand: DENSE_RANK() OVER (...). */
  denseRank(alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("dense_rank", { partitionBy, orderBy }, alias);
  }

  /** Shorthand: LAG(column) OVER (...). */
  lag(column: string, alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("lag", { column, partitionBy, orderBy }, alias);
  }

  /** Shorthand: LEAD(column) OVER (...). */
  lead(column: string, alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("lead", { column, partitionBy, orderBy }, alias);
  }

  /** Shorthand: FIRST_VALUE(column) OVER (...). */
  firstValue(column: string, alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("first_value", { column, partitionBy, orderBy }, alias);
  }

  /** Shorthand: LAST_VALUE(column) OVER (...). */
  lastValue(column: string, alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("last_value", { column, partitionBy, orderBy }, alias);
  }

  /** Shorthand: NTILE(n) OVER (...). */
  ntile(alias: string, partitionBy?: string[], orderBy?: { column: string; dir?: "asc" | "desc" }[]): QueryBuilder<T> {
    return this.window("ntile", { partitionBy, orderBy }, alias);
  }

  // ---------------------------------------------------------------------------
  // Aggregate methods
  // ---------------------------------------------------------------------------

  /** Alias: add a COUNT aggregate. */
  count(alias = "count", column?: string): QueryBuilder<T> {
    const def: AggregateDef = { fn: "count", column, alias };
    return this.fork({ aggregates: [...(this.plan.aggregates ?? []), def] });
  }

  /** Alias: add a SUM aggregate. */
  sum(column: string, alias = "sum"): QueryBuilder<T> {
    const def: AggregateDef = { fn: "sum", column, alias };
    return this.fork({ aggregates: [...(this.plan.aggregates ?? []), def] });
  }

  /** Alias: add an AVG aggregate. */
  avg(column: string, alias = "avg"): QueryBuilder<T> {
    const def: AggregateDef = { fn: "avg", column, alias };
    return this.fork({ aggregates: [...(this.plan.aggregates ?? []), def] });
  }

  /** Alias: add a MIN aggregate. */
  min(column: string, alias = "min"): QueryBuilder<T> {
    const def: AggregateDef = { fn: "min", column, alias };
    return this.fork({ aggregates: [...(this.plan.aggregates ?? []), def] });
  }

  /** Alias: add a MAX aggregate. */
  max(column: string, alias = "max"): QueryBuilder<T> {
    const def: AggregateDef = { fn: "max", column, alias };
    return this.fork({ aggregates: [...(this.plan.aggregates ?? []), def] });
  }

  // ---------------------------------------------------------------------------
  // Full-text search
  // ---------------------------------------------------------------------------

  /**
   * Add a full-text search filter.
   * ```ts
   * db.query(posts).ftsSearch("fts5", ["title", "body"], "hello" )
   * ```
   * SQLite FTS5: requires FTS virtual table. Use `tableAlias` to set it.
   * Postgres tsvector: columns are concatenated and matched.
   * MySQL FULLTEXT: requires FULLTEXT index on columns.
   */
  ftsSearch(mode: FtsDef["mode"], columns: string[], query: string, tableAlias?: string): QueryBuilder<T> {
    const def: FtsDef = { mode, columns, query, tableAlias };
    return this.fork({ fts: def });
  }

  // ---------------------------------------------------------------------------
  // JSON operations
  // ---------------------------------------------------------------------------

  /** Add JSON_EXTRACT(column, path) AS alias to SELECT. */
  jsonExtract(column: string, path: string, alias: string): QueryBuilder<T> {
    const op: JsonOp = { kind: "extract", column, path, alias };
    return this.fork({ jsonOps: [...(this.plan.jsonOps ?? []), op] });
  }

  /** Add json_agg(column) AS alias to SELECT. */
  jsonAgg(column: string, alias: string): QueryBuilder<T> {
    const op: JsonOp = { kind: "agg", column, alias };
    return this.fork({ jsonOps: [...(this.plan.jsonOps ?? []), op] });
  }

  /** Add json_object(...) AS alias to SELECT. */
  jsonObject(fields: { key: string; value: string }[], alias: string): QueryBuilder<T> {
    const op: JsonOp = { kind: "object", fields, alias };
    return this.fork({ jsonOps: [...(this.plan.jsonOps ?? []), op] });
  }

  /** Add json_array(column) AS alias to SELECT. */
  jsonArray(column: string, alias: string): QueryBuilder<T> {
    const op: JsonOp = { kind: "array", column, alias };
    return this.fork({ jsonOps: [...(this.plan.jsonOps ?? []), op] });
  }

  /** Add json_set(column, path, value) to SELECT. */
  jsonSet(column: string, path: string, value: unknown, alias: string): QueryBuilder<T> {
    const op: JsonOp = { kind: "set", column, path, value, alias };
    return this.fork({ jsonOps: [...(this.plan.jsonOps ?? []), op] });
  }

  // ---------------------------------------------------------------------------
  // Pagination helpers
  // ---------------------------------------------------------------------------

  /**
   * Apply offset pagination. Equivalent to `.offset(n).limit(m)`.
   * ```ts
   * const page = await db.query(users).paginate(1, 20).select(); // page 1, 20 per page
   * ```
   */
  paginate(page: number, perPage: number = 10): QueryBuilder<T> {
    const p = Math.max(1, Math.floor(page));
    const pp = Math.max(1, Math.min(100, Math.floor(perPage)));
    return this.fork({ limit: pp, offset: (p - 1) * pp });
  }

  /**
   * Specify RETURNING columns for INSERT/UPDATE/DELETE.
   * ```ts
   * await db.query(users).returning("id").insert({ name: "Alice" });
   * // INSERT INTO "users" ("name") VALUES (?) RETURNING "id"
   * ```
   * With no arguments, returns all columns (`RETURNING *`).
   */
  returning(...columns: string[]): QueryBuilder<T> {
    return this.fork({ returning: columns.length ? columns : ["*"] });
  }

  /**
   * Apply cursor-based pagination.
   * Returns rows after the given cursor value for the specified column.
   * ```ts
   * const next = await db.query(users)
   *   .cursor("id", lastId, "gt")
   *   .limit(20)
   *   .select();
   * ```
   */
  cursor(column: string, value: unknown, op: "gt" | "gte" = "gt"): QueryBuilder<T> {
    return this.fork({
      filters: [...this.plan.filters, { kind: "filter", column, op, value } as any],
    });
  }

  // ---- Row-level locking ----

  /** SELECT ... FOR UPDATE (row-level write lock). */
  forUpdate(nowait?: boolean, skipLocked?: boolean): QueryBuilder<T> {
    return this.fork({ lock: { mode: "update", nowait, skipLocked } });
  }
  /** SELECT ... FOR SHARE (row-level read lock). */
  forShare(nowait?: boolean, skipLocked?: boolean): QueryBuilder<T> {
    return this.fork({ lock: { mode: "share", nowait, skipLocked } });
  }
  /** SELECT ... FOR NO KEY UPDATE. */
  forNoKeyUpdate(nowait?: boolean, skipLocked?: boolean): QueryBuilder<T> {
    return this.fork({ lock: { mode: "no key update", nowait, skipLocked } });
  }
  /** SELECT ... FOR KEY SHARE. */
  forKeyShare(nowait?: boolean, skipLocked?: boolean): QueryBuilder<T> {
    return this.fork({ lock: { mode: "key share", nowait, skipLocked } });
  }

  // ---- Raw SQL expressions in SELECT / WHERE ----

  /**
   * Guard the raw-SQL escape hatches (selectExpr/whereExpr) against accidental
   * multi-statement or comment-injection when a caller interpolates untrusted
   * input. The normal builder path is injection-safe by construction; these
   * hatches are NOT (they pass SQL through unquoted). We can't know if a
   * string is user-controlled, so we reject the patterns that make injection
   * possible: stacked statements (`;`) and SQL comment tokens (`--`, `/*`).
   * Bind values via the `params` argument instead of string interpolation.
   */
  protected validateRawSql(expr: string): void {
    if (/;|--|\/\*/.test(expr)) {
      throw new MountError("VALIDATION",
        "MountSQLI: raw SQL expression rejected — contains ';', '--', or '/*' which are unsafe for an escape hatch. " +
        "Bind values with parameters; do not interpolate untrusted input into raw SQL.",
      );
    }
  }

  /**
   * Add a raw SQL expression to the SELECT clause.
   * ```ts
   * const rows = await db.query(users)
   *   .selectExpr("COUNT(*)", [], "cnt")
   *   .selectExpr("MAX(age)", [], "max_age")
   *   .select();
   * ```
   */
  /** Add a raw SQL expression to the SELECT clause (passed through unquoted). */
  selectExpr(sqlExpr: string, _params: unknown[] = [], alias: string): QueryBuilder<T> {
    this.validateRawSql(sqlExpr);
    return this.fork({
      selectExprs: [...(this.plan.selectExprs ?? []), { sql: sqlExpr, alias }],
    });
  }

  /**
   * Add a raw SQL fragment to the WHERE clause.
   * ```ts
   * const rows = await db.query(users)
   *   .whereExpr("EXISTS (SELECT 1 FROM posts WHERE posts.user_id = users.id)")
   *   .select();
   * ```
   */
  whereExpr(sqlExpr: string, params: unknown[] = []): QueryBuilder<T> {
    this.validateRawSql(sqlExpr);
    return this.fork({
      rawFilters: [...(this.plan.rawFilters ?? []), { expr: sqlExpr, params }],
    });
  }

  // ---- Fluent Relational Query API ----

  /**
   * Fetch rows with eagerly-loaded related data.
   *
   * ```ts
   * const posts = await db.query(posts)
   *   .findMany({ with: { author: true, comments: { with: { user: true } } } });
   * // posts[0].author → { id: 1, name: "Alice", ... }
   * // posts[0].comments[0].user → { id: 1, name: "Bob", ... }
   * ```
   *
   * Requires the table to have `.relations` defined via `belongsTo`/`hasMany`/`hasOne`.
   * Uses batch-loading internally (no N+1).
   */
  async findMany(opts: FindManyOptions = {}): Promise<Record<string, any>[]> {
    let plan = { ...this.plan };
    if (opts.where) {
      const whereArr = Array.isArray(opts.where) ? opts.where : [opts.where];
      plan.filters = [...plan.filters, ...whereArr];
    }
    if (opts.orderBy) plan.orderBy = [...(plan.orderBy ?? []), ...opts.orderBy];
    if (opts.limit !== undefined) plan.limit = opts.limit;
    if (opts.offset !== undefined) plan.offset = opts.offset;

    const r = await this.driver.query(compilePlan(plan, this.dialect), "many");
    const rows = r.rows as Record<string, any>[];

    if (!opts.with || rows.length === 0) return rows;

    // Load relations using batch-loading — use allTables if available, else fall back to single table
    const relTables = this.allTables ?? [this.table] as any[];
    const resolved = await resolveRelationsDeep(
      this.driver, relTables, this.table, rows, opts.with as Record<string, boolean | RelationalQuery>,
    );
    return resolved;
  }

  // ---- execution ----

  /**
   * RLS enforcement gate (issue 003). When the driver carries an `rls` config
   * with `enforce: true`, a query whose target table has a registered policy
   * must have had `applyPolicy(...)` applied (sets `plan.rlsApplied`) or be
   * explicitly opted out via `.unsafe()` (sets `plan.rlsUnsafe`). Otherwise we
   * refuse to run — a silent policy omission must not leak rows.
   */
  protected assertRls(plan: QueryPlan): void {
    const rls = this.driver.rls;
    if (!rls || !rls.enforce) return;
    if (plan.rlsUnsafe) return;
    if (rls.registry.has(plan.table) && !plan.rlsApplied) {
      throw new MountError(
        "FORBIDDEN",
        `RLS policy not applied for table "${plan.table}". Call applyPolicy(...) before executing, or use .unsafe() to opt out.`,
      );
    }
  }

  protected async run(mode: ExecuteMode): Promise<QueryResult<Row<T>>> {
    await this.driver.ready;
    this.assertRls(this.plan);
    return this.driver.query(compilePlan(this.plan, this.dialect), mode);
  }

  /**
   * SELECT — returns all matching rows, typed by selected columns.
   *
   * When called with column names, returns only those columns:
   * ```ts
   * const names = await db.query(users).select("id", "name");
   * // names: Pick<Row, "id" | "name">[]
   * ```
   */
  async select(): Promise<Row<T>[]>;
  async select<K extends StringKeyOf<Row<T>>>(...columns: K[]): Promise<PickRow<T, K>[]>;
  async select<K extends StringKeyOf<Row<T>>>(...columns: K[]): Promise<any> {
    const plan = columns.length ? { ...this.plan, columns: columns } : this.plan;
    this.assertRls(plan);
    const r = await this.driver.query(compilePlan(plan, this.dialect), "many");
    return r.rows;
  }

  /** SELECT one — returns the first match or null. */
  async findOne(): Promise<Row<T> | null> {
    const r = await this.fork({ limit: 1 }).run("one");
    return r.rows[0] ?? null;
  }

  /**
   * INSERT — one or more rows.
   *
   * Single row:
   * ```ts
   * await db.query(users).insert({ name: "Alice" });
   * ```
   *
   * Multi-row (one round trip):
   * ```ts
   * await db.query(users).insert([{ name: "Alice" }, { name: "Bob" }]);
   * ```
   */
  async insert(values: Partial<Row<T>> | Partial<Row<T>>[]): Promise<QueryResult<Row<T>>> {
    const plan: QueryPlan = { ...this.plan, op: "insert", values: Array.isArray(values) ? values : values as any };
    return this.driver.query(compilePlan(plan, this.dialect), "run");
  }

  /**
   * UPSERT — INSERT with ON CONFLICT DO UPDATE/SET.
   * ```ts
   * await db.query(users).upsert({ id: 1, name: "Alice" }, ["id"], { name: "Alice" });
   * ```
   * @param values Row values to insert.
   * @param constraint Conflict target column(s).
   * @param set Columns+values to update on conflict.
   */
  async upsert(values: Partial<Row<T>>, constraint: string | string[], set: Record<string, unknown>): Promise<QueryResult<Row<T>>> {
    const onConflict: OnConflict = { action: "update", constraint, set };
    const plan: QueryPlan = { ...this.plan, op: "insert", values: values as any, onConflict };
    return this.driver.query(compilePlan(plan, this.dialect), "run");
  }

  /**
   * INSERT ... ON CONFLICT DO NOTHING (skip on conflict).
   * ```ts
   * await db.query(users).insertIgnore({ id: 1, name: "Alice" });
   * ```
   */
  async insertIgnore(values: Partial<Row<T>>, constraint?: string | string[]): Promise<QueryResult<Row<T>>> {
    const onConflict: OnConflict = constraint ? { action: "nothing", constraint } : { action: "nothing" };
    const plan: QueryPlan = { ...this.plan, op: "insert", values: values as any, onConflict };
    return this.driver.query(compilePlan(plan, this.dialect), "run");
  }

  async update(values: Partial<Row<T>>): Promise<QueryResult<Row<T>>> {
    const plan: QueryPlan = { ...this.plan, op: "update", values: values as any };
    return this.driver.query(compilePlan(plan, this.dialect), "run");
  }

  async delete(): Promise<QueryResult<Row<T>>> {
    const plan: QueryPlan = { ...this.plan, op: "delete" };
    return this.driver.query(compilePlan(plan, this.dialect), "run");
  }

  /** Execute raw SQL through this builder's driver. */
  async raw(sqlStr: string, params?: unknown[]): Promise<any[]> {
    await this.driver.ready;
    const compiled: Compiled = { sql: sqlStr, params: params ?? [] };
    if (this.driver.columnTypes) compiled.columnTypes = this.driver.columnTypes as any;
    const r = await this.driver.query(compiled, "many");
    return r.rows;
  }

  get _plan(): QueryPlan {
    return this.plan;
  }
}

export function tableQuery<T extends Table<any>>(driver: Driver, table: T, allTables?: any[]): QueryBuilder<T> {
  return new QueryBuilder(driver, table, undefined, allTables);
}

/**
 * Transaction-scoped QueryBuilder. All execution methods use the transaction's
 * `query()` method instead of the driver's, ensuring all operations share the
 * same database connection and are committed/rolled back atomically.
 */
/**
 * Transaction-scoped QueryBuilder. Created internally by `Db.transaction()`.
 * Not intended for direct instantiation.
 */
export class TxQueryBuilder<T extends Table<any>> extends QueryBuilder<T> {
  private tx: Transaction;

  constructor(driver: Driver, table: T, plan: QueryPlan, tx: Transaction) {
    super(driver, table, plan);
    this.tx = tx;
  }

  private async txRun(mode: ExecuteMode): Promise<QueryResult<Row<T>>> {
    await this.driver.ready;
    this.assertRls(this.plan);
    return this.tx.query(compilePlan(this.plan, this.dialect), mode);
  }

  async select(): Promise<Row<T>[]>;
  async select<K extends StringKeyOf<Row<T>>>(...columns: K[]): Promise<PickRow<T, K>[]>;
  async select<K extends StringKeyOf<Row<T>>>(...columns: K[]): Promise<any> {
    const plan = columns.length ? { ...this.plan, columns } : this.plan;
    const r = await this.tx.query(compilePlan(plan, this.dialect), "many");
    return r.rows;
  }

  async findOne(): Promise<Row<T> | null> {
    const plan = { ...this.plan, limit: 1 };
    const r = await this.tx.query(compilePlan(plan, this.dialect), "one");
    return r.rows[0] ?? null;
  }

  async insert(values: Partial<Row<T>> | Partial<Row<T>>[]): Promise<QueryResult<Row<T>>> {
    const plan: QueryPlan = { ...this.plan, op: "insert", values: Array.isArray(values) ? values : values as any };
    return this.tx.query(compilePlan(plan, this.dialect), "run");
  }

  async upsert(values: Partial<Row<T>>, constraint: string | string[], set: Record<string, unknown>): Promise<QueryResult<Row<T>>> {
    const onConflict: OnConflict = { action: "update", constraint, set };
    const plan: QueryPlan = { ...this.plan, op: "insert", values: values as any, onConflict };
    return this.tx.query(compilePlan(plan, this.dialect), "run");
  }

  async insertIgnore(values: Partial<Row<T>>, constraint?: string | string[]): Promise<QueryResult<Row<T>>> {
    const onConflict: OnConflict = constraint ? { action: "nothing", constraint } : { action: "nothing" };
    const plan: QueryPlan = { ...this.plan, op: "insert", values: values as any, onConflict };
    return this.tx.query(compilePlan(plan, this.dialect), "run");
  }

  async update(values: Partial<Row<T>>): Promise<QueryResult<Row<T>>> {
    const plan: QueryPlan = { ...this.plan, op: "update", values: values as any };
    return this.tx.query(compilePlan(plan, this.dialect), "run");
  }

  async delete(): Promise<QueryResult<Row<T>>> {
    const plan: QueryPlan = { ...this.plan, op: "delete" };
    return this.tx.query(compilePlan(plan, this.dialect), "run");
  }

  returning(...columns: string[]): TxQueryBuilder<T> {
    return new TxQueryBuilder(
      this.driver,
      this.table,
      { ...this.plan, returning: columns.length ? columns : ["*"] },
      this.tx,
    );
  }
}

// ---- `sql` template tag (type-inferred raw SQL escape hatch) ----------
// The static parts are trusted; every ${} hole becomes a bound parameter.
// Full type-level column inference is a compiler-phase feature.

export interface SqlQuery {
  sql: string;
  params: unknown[];
  compile(): Compiled;
}

/**
 * SQL template tag. Every interpolation becomes a bound parameter.
 *
 * Without generic: returns `any[]`.
 * With generic `sql<Pick<Row<T>, "id" | "name">>`: returns typed results.
 *
 * ```ts
 * const rows = await db.sql<{ id: number; name: string }>`SELECT id, name FROM users WHERE id = ${id}`;
 * ```
 */
// ---- Fluent Relational Query API ----

export interface RelationalQuery {
  with?: Record<string, boolean | RelationalQuery>;
  where?: FilterNode | ((col: string, op: Comparator, val: unknown) => FilterNode);
  orderBy?: { column: string; dir?: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

export interface FindManyOptions {
  with?: Record<string, boolean | RelationalQuery>;
  where?: FilterNode | FilterNode[];
  orderBy?: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
  offset?: number;
}

// ---- Composable filter operators ----
// These return FilterNode objects that can be composed with `and()` / `or()`.
// Usage: `.where(and(eq("age", 18), or(eq("status", "active"), eq("role", "admin"))))`

export function eq(col: string, val: unknown): FilterNode {
  return { kind: "filter", column: col, op: "=", value: val };
}
export function ne(col: string, val: unknown): FilterNode {
  return { kind: "filter", column: col, op: "!=", value: val };
}
export function gt(col: string, val: unknown): FilterNode {
  return { kind: "filter", column: col, op: ">", value: val };
}
export function gte(col: string, val: unknown): FilterNode {
  return { kind: "filter", column: col, op: ">=", value: val };
}
export function lt(col: string, val: unknown): FilterNode {
  return { kind: "filter", column: col, op: "<", value: val };
}
export function lte(col: string, val: unknown): FilterNode {
  return { kind: "filter", column: col, op: "<=", value: val };
}
export function like(col: string, val: string): FilterNode {
  return { kind: "filter", column: col, op: "like", value: val };
}
export function inArray(col: string, val: unknown[]): FilterNode {
  return { kind: "filter", column: col, op: "in", value: val };
}
export function isNull(col: string): FilterNode {
  return { kind: "filter", column: col, op: "is", value: null };
}

/**
 * Combines filters with AND. All sub-filters must match.
 * ```ts
 * .where(and(eq("age", 18), eq("status", "active")))
 * // → WHERE ("age" = ? AND "status" = ?)
 * ```
 */
export function and(...filters: FilterNode[]): FilterNode {
  if (filters.length === 1) return filters[0]!;
  return { kind: "and", filters };
}

/**
 * Combines filters with OR. Any sub-filter must match.
 * ```ts
 * .where(or(eq("status", "active"), eq("role", "admin")))
 * // → WHERE ("status" = ? OR "role" = ?)
 * ```
 */
export function or(...filters: FilterNode[]): FilterNode {
  if (filters.length === 1) return filters[0]!;
  return { kind: "or", filters };
}

/** Operator for .where() — accepts a raw triple OR a composable FilterNode. */
export function whereFilter(colOrFilter: string | FilterNode, op?: string, val?: unknown): FilterNode {
  if (typeof colOrFilter === "object" && "kind" in colOrFilter) return colOrFilter;
  return { kind: "filter", column: String(colOrFilter), op: String(op) as Comparator, value: val };
}

/**
 * Recursively load relations using batch queries.
 * Used internally by `findMany()`.
 */
const _q = (id: string): string => `"${id.replace(/"/g, '""')}"`;

async function resolveRelationsDeep(
  driver: Driver,
  allTables: any[],
  table: any,
  rows: Record<string, any>[],
  withOpts: Record<string, boolean | RelationalQuery>,
  depth = 0,
): Promise<Record<string, any>[]> {
  if (depth > 4 || rows.length === 0) return rows;
  const rels = table.relations as any[] | undefined;
  if (!rels) return rows;

  let resolved = [...rows];

  for (const [relName, opts] of Object.entries(withOpts)) {
    const nested = typeof opts === "object" ? opts : undefined;
    const rel = rels.find((r: any) => r.name === relName);
    if (!rel) continue;
    let targetTable = allTables.find((t: any) => t.__name === rel.targetTable);
    // When the target table isn't in allTables (e.g. findMany only has one table),
    // create a minimal stub so relation loading still works.
    if (!targetTable) {
      targetTable = { __name: rel.targetTable, __cols: {}, relations: [] };
    }

    if (rel.kind === "belongsTo") {
      const fkValues = [...new Set(resolved.map((r) => r[rel.foreignKey]).filter(Boolean))];
      if (fkValues.length === 0) continue;
      const holes = fkValues.map(() => "?").join(",");
      const ct: Record<string, any> = {};
      for (const [n, b] of Object.entries((targetTable as any).__cols ?? {})) {
        ct[n] = (b as any).def?.type ?? "text";
      }
      const compiled: Compiled = { sql: `SELECT * FROM ${_q(rel.targetTable)} WHERE ${_q(rel.localKey)} IN (${holes})`, params: fkValues, columnTypes: ct };
      const raw = await driver.query(compiled, "many");
      const relatedMap = new Map(raw.rows.map((r: any) => [r[rel.localKey], r]));
      resolved = resolved.map((r) => ({ ...r, [relName]: relatedMap.get(r[rel.foreignKey]) ?? null }));
      // recurse nested with
      if (nested?.with) {
        for (const row of [...relatedMap.values()] as any[]) {
          Object.assign(row, await resolveRelationsDeep(driver, allTables, targetTable, [row], nested.with, depth + 1).then((r) => r[0]));
        }
      }
    }

    if (rel.kind === "hasMany" || rel.kind === "hasOne") {
      const localValues = [...new Set(resolved.map((r) => r[rel.localKey]).filter(Boolean))];
      if (localValues.length === 0) continue;
      const holes = localValues.map(() => "?").join(",");
      const ct: Record<string, any> = {};
      for (const [n, b] of Object.entries((targetTable as any).__cols ?? {})) {
        ct[n] = (b as any).def?.type ?? "text";
      }
      const compiled: Compiled = { sql: `SELECT * FROM ${_q(rel.targetTable)} WHERE ${_q(rel.foreignKey)} IN (${holes})`, params: localValues, columnTypes: ct };
      const raw = await driver.query(compiled, "many");
      if (rel.kind === "hasMany") {
        const grouped = new Map<any, any[]>();
        for (const row of raw.rows as any[]) {
          const val = row[rel.foreignKey];
          if (!grouped.has(val)) grouped.set(val, []);
          grouped.get(val)!.push(row);
        }
        resolved = resolved.map((r) => ({ ...r, [relName]: grouped.get(r[rel.localKey]) ?? [] }));
        const allRelated = [...grouped.values()].flat();
        if (nested?.with) {
          for (const row of allRelated as any[]) {
            Object.assign(row, await resolveRelationsDeep(driver, allTables, targetTable, [row], nested.with, depth + 1).then((r) => r[0]));
          }
        }
      } else {
        // hasOne
        const relatedMap = new Map<any, any>();
        for (const row of raw.rows as any[]) {
          if (!relatedMap.has(row[rel.foreignKey])) {
            relatedMap.set(row[rel.foreignKey], row);
          }
        }
        resolved = resolved.map((r) => ({ ...r, [relName]: relatedMap.get(r[rel.localKey]) ?? null }));
        if (nested?.with) {
          for (const row of [...relatedMap.values()] as any[]) {
            Object.assign(row, await resolveRelationsDeep(driver, allTables, targetTable, [row], nested.with, depth + 1).then((r) => r[0]));
          }
        }
      }
    }
  }

  return resolved;
}

export function sql<T = any>(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  const parts: string[] = [];
  strings.forEach((s, i) => {
    parts.push(s);
    if (i < values.length) parts.push("?");
  });
  const sqlStr = parts.join("").trim().replace(/\s+/g, " ");
  const params = values;
  return {
    sql: sqlStr,
    params,
    compile() {
      return { sql: sqlStr, params };
    },
  };
}
