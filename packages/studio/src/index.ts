// MountSQLI — Studio package entry point.
//
// A self-contained visual dashboard for the database your app already uses.
// It attaches to a live `Db` (produced by `mount`/`mountsqli`) and exposes the
// engine — there is no separate database client, no config to maintain.

export { makeStudioContext, type StudioContext } from "./controller.js";
export { handleStudio, startStudioServer, type StudioServerOptions } from "./server.js";
export {
  buildMergedContext,
  startMergedServer,
  handleMerged,
  type MergedContext,
  type MergedOptions,
} from "./serve.js";
export {
  listTables,
  tableData,
  insertRow,
  updateRow,
  deleteRow,
  runSql,
  erd,
  migrations,
  health,
} from "./controller.js";
