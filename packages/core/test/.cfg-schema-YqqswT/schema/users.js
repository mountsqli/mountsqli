import { defineTable, int, text } from "@mountsqli/core";
export const users = defineTable("users", { id: int().pk(), email: text().notNull() });
export const NOT_A_TABLE = 42; // ignored