import type { SidebarEntry } from '@astrojs/starlight/sidebar';

/**
 * MountSQLI documentation sidebar.
 * Order = learning order. Each folder is one top-level group.
 * Keep this in sync with the files under src/content/docs/.
 */
export const sidebar: SidebarEntry[] = [
  {
    label: 'Getting Started',
    items: [
      { label: 'Introduction', slug: 'getting-started/introduction' },
      { label: 'Why MountSQLI?', slug: 'getting-started/why-mountsqli' },
      { label: 'Installation', slug: 'getting-started/installation' },
      { label: 'Quick Start', slug: 'getting-started/quick-start' },
      { label: 'Your First Project', slug: 'getting-started/first-project' },
      { label: 'Core Concepts', slug: 'getting-started/core-concepts' },
    ],
  },
  {
    label: 'Schema',
    items: [
      { label: 'Defining Tables', slug: 'schema/defining-tables' },
      { label: 'Column Types', slug: 'schema/column-types' },
      { label: 'Constraints & Defaults', slug: 'schema/constraints' },
      { label: 'InferTable', slug: 'schema/infertable' },
      { label: 'DDL Generation', slug: 'schema/ddl' },
    ],
  },
  {
    label: 'Query Builder',
    items: [
      {
        label: 'Read',
        items: [
          { label: 'Select', slug: 'query-builder/select' },
          { label: 'Filtering', slug: 'query-builder/filtering' },
          { label: 'Joins', slug: 'query-builder/joins' },
          { label: 'Ordering & Pagination', slug: 'query-builder/ordering' },
          { label: 'Aggregates', slug: 'query-builder/aggregates' },
          { label: 'Group By & Having', slug: 'query-builder/group-by' },
          { label: 'Window Functions', slug: 'query-builder/window-functions' },
          { label: 'CTE & Subqueries', slug: 'query-builder/cte' },
        ],
      },
      {
        label: 'Write',
        items: [
          { label: 'Insert', slug: 'query-builder/insert' },
          { label: 'Update', slug: 'query-builder/update' },
          { label: 'Delete', slug: 'query-builder/delete' },
          { label: 'Upsert (ON CONFLICT)', slug: 'query-builder/upsert' },
        ],
      },
      {
        label: 'Advanced',
        items: [
          { label: 'Raw SQL & RLS Gate', slug: 'query-builder/raw-sql' },
        ],
      },
    ],
  },
  {
    label: 'Migrations',
    items: [
      { label: 'How Migrations Work', slug: 'migrations/how' },
      { label: 'Generate', slug: 'migrations/generate' },
      { label: 'Apply', slug: 'migrations/apply' },
      { label: 'Status', slug: 'migrations/status' },
      { label: 'Rollback', slug: 'migrations/rollback' },
      { label: 'Introspect', slug: 'migrations/introspect' },
    ],
  },
  {
    label: 'CLI',
    items: [
      { label: 'Overview', slug: 'cli/overview' },
      { label: 'Commands', slug: 'cli/commands' },
      { label: 'mountsqli dev', slug: 'cli/dev' },
      { label: 'mountsqli analyze', slug: 'cli/analyze' },
    ],
  },
  {
    label: 'Studio',
    items: [
      { label: 'Overview', slug: 'studio/overview' },
      { label: 'Data Browser', slug: 'studio/data-browser' },
      { label: 'SQL Console', slug: 'studio/sql-console' },
      { label: 'ERD Viewer', slug: 'studio/erd' },
      { label: 'Migrations View', slug: 'studio/migrations' },
      { label: 'Cache Inspector', slug: 'studio/cache' },
    ],
  },
  {
    label: 'Auth',
    items: [
      { label: 'Overview', slug: 'auth/overview' },
      { label: 'Passwords & JWT', slug: 'auth/passwords-jwt' },
      { label: 'Sessions', slug: 'auth/sessions' },
      { label: 'RBAC', slug: 'auth/rbac' },
      { label: 'RLS Policy DSL', slug: 'auth/rls' },
      { label: 'OAuth & Providers', slug: 'auth/oauth' },
      { label: 'Rate Limiting', slug: 'auth/rate-limiting' },
    ],
  },
  {
    label: 'API',
    items: [
      { label: 'Overview', slug: 'api/overview' },
      { label: 'REST Handler', slug: 'api/rest' },
      { label: 'OpenAPI & Codegen', slug: 'api/openapi' },
      { label: 'RPC', slug: 'api/rpc' },
      { label: 'Auth Middleware', slug: 'api/auth-middleware' },
    ],
  },
  {
    label: 'Storage',
    items: [
      { label: 'Overview', slug: 'storage/overview' },
      { label: 'Signed URLs', slug: 'storage/signed-urls' },
      { label: 'Versioning', slug: 'storage/versioning' },
      { label: 'S3 Adapter', slug: 'storage/s3' },
    ],
  },
  {
    label: 'Realtime',
    items: [
      { label: 'Overview', slug: 'realtime/overview' },
      { label: 'Presence', slug: 'realtime/presence' },
      { label: 'Live Queries', slug: 'realtime/live-queries' },
    ],
  },
  {
    label: 'Cache',
    items: [
      { label: 'Overview', slug: 'cache/overview' },
      { label: 'Eviction Policies', slug: 'cache/eviction' },
      { label: 'Tags & Invalidation', slug: 'cache/tags' },
      { label: 'Analyzer', slug: 'cache/analyzer' },
    ],
  },
  {
    label: 'AI',
    items: [
      { label: 'Overview', slug: 'ai/overview' },
      { label: 'Natural Language → SQL', slug: 'ai/nl-to-sql' },
      { label: 'Explain / Optimize / Review', slug: 'ai/assist' },
    ],
  },
  {
    label: 'Drivers',
    items: [
      { label: 'Overview', slug: 'drivers/overview' },
      { label: 'SQLite', slug: 'drivers/sqlite' },
      { label: 'Postgres', slug: 'drivers/postgres' },
      { label: 'MySQL', slug: 'drivers/mysql' },
    ],
  },
  {
    label: 'Architecture',
    items: [
      { label: 'How MountSQLI Works', slug: 'architecture/how-it-works' },
      { label: 'QueryPlan IR', slug: 'architecture/queryplan' },
      { label: 'Compiler & Dialects', slug: 'architecture/compiler' },
      { label: 'Query Execution', slug: 'architecture/execution' },
      { label: 'Type-Safety System', slug: 'architecture/type-safety' },
      { label: 'Caching Layer', slug: 'architecture/caching' },
      { label: 'Performance', slug: 'architecture/performance' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Deployment', slug: 'operations/deployment' },
      { label: 'Testing', slug: 'operations/testing' },
      { label: 'Error Handling', slug: 'operations/error-handling' },
    ],
  },
  {
    label: 'Examples',
    items: [
      { label: 'Express + Postgres', slug: 'examples/express' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'API Reference', slug: 'reference/api' },
      { label: 'Glossary', slug: 'reference/glossary' },
      { label: 'Upgrade Guide', slug: 'reference/upgrade' },
      { label: 'FAQ', slug: 'reference/faq' },
      { label: 'Roadmap', slug: 'reference/roadmap' },
      { label: 'Contributing', slug: 'reference/contributing' },
    ],
  },
];
