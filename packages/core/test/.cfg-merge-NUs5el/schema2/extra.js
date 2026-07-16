import { defineTable, int, text } from "@mountsqli/core";
export const tags = defineTable("tags", { id: int().pk(), label: text().notNull() });