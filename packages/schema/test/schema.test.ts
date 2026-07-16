import { describe, it, expect } from "vitest";
import {
  defineTable,
  int,
  text,
  real,
  bool,
  blob,
  json,
  uuid,
  timestamp,
  createTableSQL,
  quote,
  type ColumnType,
  type TableDef,
} from "../src/index.js";

describe("defineTable", () => {
  it("creates a table with inferred def", () => {
    const users = defineTable("users", {
      id: int().pk(),
      email: text().notNull().unique(),
    });
    expect(users.def.name).toBe("users");
    expect(users.def.columns).toHaveLength(2);
    expect(users.def.columns[0]).toMatchObject({ name: "id", type: "int", primaryKey: true, nullable: false });
    expect(users.def.columns[1]).toMatchObject({ name: "email", type: "text", nullable: false, unique: true });
  });

  it("defaults nullable to false and primaryKey/unique to false", () => {
    const t = defineTable("t", { age: int() });
    expect(t.def.columns[0].nullable).toBe(false);
    expect(t.def.columns[0].primaryKey).toBe(false);
    expect(t.def.columns[0].unique).toBe(false);
  });

  it("supports nullable columns", () => {
    const t = defineTable("t", { bio: text().nullable() });
    expect(t.def.columns[0].nullable).toBe(true);
  });

  it("supports defaults", () => {
    const t = defineTable("t", {
      label: text().default("hello"),
      count: int().default(42),
      active: bool().default(true),
    });
    expect(t.def.columns[0].default).toBe("hello");
    expect(t.def.columns[1].default).toBe(42);
    expect(t.def.columns[2].default).toBe(true);
  });
});

describe("column builders", () => {
  it("int builds int columns", () => {
    expect(int().def.type).toBe("int");
  });
  it("text builds text columns", () => {
    expect(text().def.type).toBe("text");
  });
  it("real builds real columns", () => {
    expect(real().def.type).toBe("real");
  });
  it("bool builds bool columns", () => {
    expect(bool().def.type).toBe("bool");
  });
  it("blob builds blob columns", () => {
    expect(blob().def.type).toBe("blob");
  });
  it("json builds json columns", () => {
    expect(json().def.type).toBe("json");
  });
  it("uuid builds uuid columns", () => {
    expect(uuid().def.type).toBe("uuid");
  });
  it("timestamp builds timestamp columns", () => {
    expect(timestamp().def.type).toBe("timestamp");
  });
});

describe("createTableSQL", () => {
  const users: TableDef = {
    name: "users",
    columns: [
      { name: "id", type: "int", nullable: false, primaryKey: true, unique: false },
      { name: "email", type: "text", nullable: false, primaryKey: false, unique: true },
      { name: "name", type: "text", nullable: true, primaryKey: false, unique: false },
      { name: "active", type: "bool", nullable: false, primaryKey: false, unique: false, default: true },
    ],
  };

  it("generates CREATE TABLE with columns and constraints", () => {
    const sql = createTableSQL(users);
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "users"');
    expect(sql).toContain('"id" INTEGER PRIMARY KEY');
    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
    expect(sql).toContain('"name" TEXT');
    expect(sql).toContain('"active" INTEGER NOT NULL DEFAULT 1');
  });

  it("supports custom type mapping", () => {
    const typeName = (t: ColumnType): string => (t === "text" ? "TEXT" : t === "int" ? "BIGINT" : "???");
    const sql = createTableSQL(users, typeName);
    expect(sql).toContain("BIGINT PRIMARY KEY");
    expect(sql).toContain("TEXT NOT NULL UNIQUE");
  });

  it("adds AUTO_INCREMENT when requested", () => {
    const sql = createTableSQL(users, undefined, "AUTO_INCREMENT");
    expect(sql).toContain("INTEGER PRIMARY KEY AUTO_INCREMENT");
  });
});

describe("quote", () => {
  it("wraps simple identifiers in double quotes", () => {
    expect(quote("users")).toBe('"users"');
  });
  it("escapes embedded double quotes", () => {
    expect(quote('bad"name')).toBe('"bad""name"');
  });
});
