// MountSQLI Express Example — Seed script (Postgres).
// DATABASE_URL=postgres://user:pass@localhost:5432/mydb pnpm seed

import "@mountsqli/driver-postgres";
import { mountsqli } from "@mountsqli/core";
import { users, posts, comments, categories, post_categories, profiles } from "../schema/index.js";
import config from "../mountsqli.config.js";
async function seed() {
  const db = await mountsqli(config);

  // Clear existing data (order matters for FK constraints)
  for (const table of [post_categories, comments, posts, profiles, categories, users]) {
    try { await db.query(table).delete(); } catch { /* table may be empty */ }
  }

  // ── Users ─────────────────────────────────────────────────────────────
  const userData = [
    { username: "alice",   display_name: "Alice Wonder",   email: "alice@test.com",   role: "admin",    points: 1500, active: true,  metadata: { theme: "dark", notifications: true } },
    { username: "bob",     display_name: "Bob Builder",     email: "bob@test.com",     role: "user",     points: 850,  active: true,  metadata: { theme: "light", notifications: false } },
    { username: "charlie", display_name: "Charlie Brown",   email: "charlie@test.com", role: "moderator", points: 2300, active: true,  metadata: { theme: "dark" } },
    { username: "diana",   display_name: "Diana Prince",    email: "diana@test.com",   role: "user",     points: 120,  active: false, metadata: null },
    { username: "eve",     display_name: "Eve Explorer",    email: "eve@test.com",     role: "user",     points: 3400, active: true,  metadata: { theme: "auto" } },
    { username: "frank",   display_name: "Frank Castle",    email: "frank@test.com",   role: "user",     points: 75,   active: true,  metadata: null },
    { username: "grace",   display_name: "Grace Hopper",    email: "grace@test.com",   role: "admin",    points: 4200, active: true,  metadata: { notifications: false } },
  ];

  const insertedUsers: any[] = [];
  for (const u of userData) {
    const row = { ...u, metadata: u.metadata ?? null };
    const r = await db.query(users).returning("id").insert(row);
    insertedUsers.push(r.rows[0]!);
  }
  console.log(`✓ Seeded ${insertedUsers.length} users`);

  // ── Categories ─────────────────────────────────────────────────────────
  const catData = [
    { name: "Technology",   slug: "tech",       description: "Tech news and tutorials",     sort_order: 1 },
    { name: "Design",       slug: "design",     description: "UI/UX and visual design",     sort_order: 2 },
    { name: "Science",      slug: "science",    description: "Scientific discoveries",       sort_order: 3 },
    { name: "Gaming",       slug: "gaming",     description: "Video games and esports",     sort_order: 4 },
    { name: "Music",        slug: "music",      description: "Music production and theory", sort_order: 5 },
  ];

  const insertedCats: any[] = [];
  for (const c of catData) {
    const r = await db.query(categories).returning("id").insert(c);
    insertedCats.push(r.rows[0]!);
  }
  console.log(`✓ Seeded ${insertedCats.length} categories`);

  // ── Posts ─────────────────────────────────────────────────────────────
  const postData = [
    { user_id: insertedUsers[0]!.id, title: "Getting Started with TypeScript",            slug: "getting-started-ts",     excerpt: "A beginner's guide",   body: "TypeScript is a typed superset of JavaScript...".repeat(10), status: "published", view_count: 1200 },
    { user_id: insertedUsers[0]!.id, title: "Advanced SQL Patterns",                      slug: "advanced-sql",           excerpt: "Deep dive into SQL",   body: "SQL is incredibly powerful...".repeat(15),            status: "published", view_count: 890 },
    { user_id: insertedUsers[1]!.id, title: "Building REST APIs",                         slug: "building-rest-apis",     excerpt: "API design patterns",  body: "REST APIs are everywhere...".repeat(12),             status: "published", view_count: 2300 },
    { user_id: insertedUsers[1]!.id, title: "Draft: My Secret Project",                   slug: "secret-project",         excerpt: "Shh!",                 body: "This is a draft post...".repeat(5),                  status: "draft",    view_count: 0 },
    { user_id: insertedUsers[2]!.id, title: "Database Migrations Explained",              slug: "db-migrations",          excerpt: "Migrate safely",       body: "Database migrations help...".repeat(10),             status: "published", view_count: 567 },
    { user_id: insertedUsers[2]!.id, title: "Why ORMs Are Great",                         slug: "why-orms",               excerpt: "ORM benefits",         body: "Object-Relational Mapping...".repeat(8),             status: "published", view_count: 3400 },
    { user_id: insertedUsers[3]!.id, title: "Archived: Old News",                         slug: "old-news",               excerpt: "From 2024",            body: "This is an archived post...".repeat(3),              status: "archived", view_count: 45 },
    { user_id: insertedUsers[4]!.id, title: "Edge Computing Trends",                      slug: "edge-computing",         excerpt: "The edge revolution",  body: "Edge computing is changing...".repeat(10),           status: "published", view_count: 1789 },
    { user_id: insertedUsers[4]!.id, title: "Machine Learning 101",                       slug: "ml-101",                 excerpt: "ML basics",            body: "Machine learning is...".repeat(12),                  status: "published", view_count: 4500 },
    { user_id: insertedUsers[6]!.id, title: "Compiler Design Patterns",                   slug: "compiler-patterns",      excerpt: "Build a compiler",     body: "Compilers are fascinating...".repeat(15),            status: "draft",    view_count: 234 },
    { user_id: insertedUsers[6]!.id, title: "Postgres vs SQLite",                         slug: "pg-vs-sqlite",           excerpt: "DB comparison",        body: "Choosing a database...".repeat(10),                  status: "published", view_count: 2800 },
    { user_id: insertedUsers[0]!.id, title: "Node.js Streams Deep Dive",                  slug: "node-streams",           excerpt: "Stream processing",    body: "Node.js streams are...".repeat(8),                   status: "published", view_count: 1100 },
  ];

  const insertedPosts: any[] = [];
  for (const p of postData) {
    const r = await db.query(posts).returning("id").insert(p);
    insertedPosts.push(r.rows[0]!);
  }
  console.log(`✓ Seeded ${insertedPosts.length} posts`);

  // ── Post-Categories ───────────────────────────────────────────────────
  const pcData = [
    { post_id: insertedPosts[0]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[1]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[2]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[2]!.id, category_id: insertedCats[1]!.id },
    { post_id: insertedPosts[4]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[5]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[7]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[7]!.id, category_id: insertedCats[2]!.id },
    { post_id: insertedPosts[8]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[8]!.id, category_id: insertedCats[2]!.id },
    { post_id: insertedPosts[10]!.id, category_id: insertedCats[0]!.id },
    { post_id: insertedPosts[10]!.id, category_id: insertedCats[3]!.id },
    { post_id: insertedPosts[11]!.id, category_id: insertedCats[0]!.id },
  ];

  for (const pc of pcData) {
    await db.query(post_categories).insert(pc);
  }
  console.log(`✓ Seeded ${pcData.length} post-category links`);

  // ── Comments ──────────────────────────────────────────────────────────
  const commentData = [
    { post_id: insertedPosts[0]!.id, user_id: insertedUsers[1]!.id, body: "Great article! Very helpful for beginners." },
    { post_id: insertedPosts[0]!.id, user_id: insertedUsers[2]!.id, body: "I learned a lot from this. Thanks!" },
    { post_id: insertedPosts[2]!.id, user_id: insertedUsers[0]!.id, body: "Nice overview of REST API patterns." },
    { post_id: insertedPosts[2]!.id, user_id: insertedUsers[4]!.id, body: "Could you add more on authentication?" },
    { post_id: insertedPosts[2]!.id, user_id: insertedUsers[6]!.id, body: "Well structured and easy to follow." },
    { post_id: insertedPosts[5]!.id, user_id: insertedUsers[0]!.id, body: "I disagree with some points here." },
    { post_id: insertedPosts[5]!.id, user_id: insertedUsers[1]!.id, body: "ORM really does save development time." },
    { post_id: insertedPosts[8]!.id, user_id: insertedUsers[0]!.id, body: "ML is the future! Great intro." },
    { post_id: insertedPosts[8]!.id, user_id: insertedUsers[1]!.id, body: "Would love a follow-up on neural networks." },
    { post_id: insertedPosts[8]!.id, user_id: insertedUsers[2]!.id, body: "Clear explanations throughout." },
    { post_id: insertedPosts[10]!.id, user_id: insertedUsers[1]!.id, body: "SQLite is great for small projects." },
    { post_id: insertedPosts[10]!.id, user_id: insertedUsers[4]!.id, body: "Postgres wins for production though." },
    { post_id: insertedPosts[11]!.id, user_id: insertedUsers[2]!.id, body: "Streams changed how I write Node.js." },
  ];

  for (const c of commentData) {
    await db.query(comments).insert(c);
  }
  console.log(`✓ Seeded ${commentData.length} comments`);

  // ── Profiles (hasOne) ─────────────────────────────────────────────────
  const profileData = [
    { user_id: insertedUsers[0]!.id, website: "https://alice.dev", company: "Wonder Tech",  location: "San Francisco, CA", bio_long: "Full-stack developer and tech writer.", social_links: { twitter: "@alice", github: "alice" } },
    { user_id: insertedUsers[1]!.id, website: "https://bob.build", company: "BuildCo",       location: "New York, NY",      bio_long: "Backend engineer and API designer.",  social_links: { twitter: "@bob", github: "bob" } },
    { user_id: insertedUsers[2]!.id, website: "https://charlie.dev", company: "ModCo",       location: "Austin, TX",        bio_long: "Community manager and DevOps.",       social_links: { twitter: "@charlie" } },
    { user_id: insertedUsers[4]!.id, website: "https://eve.explore",  company: "Explore Inc", location: "Seattle, WA",      bio_long: "Data scientist and ML enthusiast.",   social_links: { github: "eve" } },
    { user_id: insertedUsers[6]!.id, website: "https://grace.dev",    company: "GraceSoft",   location: "Portland, OR",     bio_long: "Systems engineer and compiler nerd.", social_links: { twitter: "@grace", github: "grace" } },
  ];

  for (const p of profileData) {
    await db.query(profiles).insert({ ...p, social_links: p.social_links ?? null });
  }
  console.log(`✓ Seeded ${profileData.length} profiles`);
  console.log("\n✅ Database seeded successfully! Start the server with: pnpm dev");
  await db.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
