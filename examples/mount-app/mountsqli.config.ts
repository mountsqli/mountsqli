import { defineConfig } from "@mountsqli/core";
import { users, posts, comments, categories, post_categories, tags, post_tags, profiles, files } from "@/schema/index";
import "dotenv/config";

export default defineConfig({
  driver: "postgres",
  url: process.env.DATABASE_URL,
  tables: [users, posts, comments, categories, post_categories, tags, post_tags, profiles, files],
  cache: {
    driver: "redis",
    url: process.env.REDIS_URL ?? "redis://localhost:6379",
    maxSize: 1000,
  },
  auth: {
    jwtKey: process.env.JWT_SECRET ?? "dev-secret",
  },
  storage: {
    basePath: "./uploads",
  },
  realtime: {
    enabled: true,
  },
});
