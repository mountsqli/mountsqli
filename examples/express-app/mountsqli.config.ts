import { defineConfig } from "@mountsqli/core";
import { users, posts, comments, categories, post_categories, profiles } from "./schema/index";
import 'dotenv/config'

export default defineConfig({
  driver: "postgres",
  url: process.env.DATABASE_URL,
  tables: [users, posts, comments, categories, post_categories, profiles],
});
