// MountSQLI — Express example schema (Postgres).
// Demonstrates all schema features: uuid PKs, enum types, FK references,
// defaultNow, onUpdate, checks, multi-column constraints, relations.

import { defineTable, int, text, bool, timestamp, json, uuid, enum_ } from "@mountsqli/core";
import { belongsTo, hasMany, hasOne } from "@mountsqli/schema";

// ── Users ────────────────────────────────────────────────────────────────
export const users = defineTable("users", {
  id: uuid().pk().default("gen_random_uuid()"),
  username: text().notNull().unique(),
  email: text().notNull().unique(),
  display_name: text().notNull(),
  bio: text().nullable(),
  avatar_url: text().nullable(),
  role: enum_("user", "admin", "moderator").notNull().default("user"),
  metadata: json().nullable(),
  active: bool().notNull().default(true),
  points: int().notNull().default(0),
  created_at: timestamp().defaultNow(),
  updated_at: timestamp().defaultNow().onUpdate(),
}, {
  checks: ["email <> ''", "points >= 0"],
  relations: [
    hasMany("posts").foreignKey("user_id").localKey("id"),
    hasMany("comments").foreignKey("user_id").localKey("id"),
    hasOne("profile").foreignKey("user_id").localKey("id"),
  ],
});

// ── Categories ───────────────────────────────────────────────────────────
export const categories = defineTable("categories", {
  id: uuid().pk().default("gen_random_uuid()"),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  description: text().nullable(),
  sort_order: int().notNull().default(0),
  created_at: timestamp().defaultNow(),
});

// ── Posts ────────────────────────────────────────────────────────────────
export const posts = defineTable("posts", {
  id: uuid().pk().default("gen_random_uuid()"),
  user_id: uuid().notNull().references("users", "id", { onDelete: "CASCADE" }),
  title: text().notNull(),
  slug: text().notNull().unique(),
  excerpt: text().nullable(),
  body: text().nullable(),
  status: enum_("draft", "published", "archived").notNull().default("draft"),
  view_count: int().notNull().default(0),
  published_at: timestamp().nullable(),
  created_at: timestamp().defaultNow(),
  updated_at: timestamp().defaultNow().onUpdate(),
}, {
  checks: ["title <> ''"],
  relations: [
    belongsTo("author", "users").foreignKey("user_id").localKey("id"),
    hasMany("comments").foreignKey("post_id").localKey("id"),
    hasMany("post_categories").foreignKey("post_id").localKey("id"),
  ],
});

// ── Comments ─────────────────────────────────────────────────────────────
export const comments = defineTable("comments", {
  id: uuid().pk().default("gen_random_uuid()"),
  post_id: uuid().notNull().references("posts", "id", { onDelete: "CASCADE" }),
  user_id: uuid().notNull().references("users", "id", { onDelete: "CASCADE" }),
  body: text().notNull(),
  upvotes: int().notNull().default(0),
  created_at: timestamp().defaultNow(),
}, {
  checks: ["body <> ''"],
  relations: [
    belongsTo("author", "users").foreignKey("user_id").localKey("id"),
    belongsTo("post", "posts").foreignKey("post_id").localKey("id"),
  ],
});

// ── Post-Categories join table (composite PK) ────────────────────────────
export const post_categories = defineTable("post_categories", {
  post_id: uuid().notNull().references("posts", "id", { onDelete: "CASCADE" }),
  category_id: uuid().notNull().references("categories", "id", { onDelete: "CASCADE" }),
}, {
  primaryKey: ["post_id", "category_id"],
  relations: [
    belongsTo("post", "posts").foreignKey("post_id").localKey("id"),
    belongsTo("category", "categories").foreignKey("category_id").localKey("id"),
  ],
});

// ── User Profiles (hasOne) ───────────────────────────────────────────────
export const profiles = defineTable("profiles", {
  id: uuid().pk().default("gen_random_uuid()"),
  user_id: uuid().notNull().unique().references("users", "id", { onDelete: "CASCADE" }),
  website: text().nullable(),
  company: text().nullable(),
  location: text().nullable(),
  bio_long: text().nullable(),
  social_links: json().nullable(),
  created_at: timestamp().defaultNow(),
  updated_at: timestamp().defaultNow().onUpdate(),
}, {
  relations: [
    belongsTo("user", "users").foreignKey("user_id").localKey("id"),
  ],
});
