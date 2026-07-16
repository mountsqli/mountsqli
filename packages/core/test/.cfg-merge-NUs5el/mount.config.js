import { defineTable, int } from "@mountsqli/core";
const inline = defineTable("inline", { id: int().pk() });
export default { driver: "sqlite", tables: [inline], schema: "./schema2" };