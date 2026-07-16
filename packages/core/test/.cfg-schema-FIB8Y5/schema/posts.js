import { defineTable, int } from "@mountsqli/core";
export const posts = defineTable("posts", { id: int().pk(), authorId: int().notNull() });