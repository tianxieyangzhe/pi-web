#!/usr/bin/env node
"use strict";
// Inspection only. This script has no migration/execute flag and never writes SQL.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Database = require("better-sqlite3");
function inspect(filename) {
  filename = path.resolve(filename);
  const root = path.resolve(__dirname, "..");
  const schemaRoot = fs.existsSync(path.join(root, "runtime/database"))
    ? path.join(root, "runtime/database")
    : path.join(root, "src/infrastructure/database");
  const names = [
    "core-schema.sql",
    "role-schema.sql",
    "workspace-schema.sql",
    "image-schema.sql",
  ];
  const schemas = names.map((name) =>
    fs.readFileSync(path.join(schemaRoot, name), "utf8"),
  );
  const target = new Database(":memory:");
  target.exec(schemas.join("\n"));
  const query =
    "SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
  const expected = target.prepare(query).all();
  const expectedTables = expected
    .filter((row) => row.type === "table")
    .map((row) => row.name);
  target.close();
  const ddlSha256 = crypto
    .createHash("sha256")
    .update(schemas[3])
    .digest("hex");
  if (!fs.existsSync(filename))
    return {
      status: "absent",
      existingTables: 0,
      targetTables: expectedTables.length,
      addedTables: expectedTables.filter((name) => name.startsWith("image_")),
      ddlSha256,
      migrationExecuted: false,
    };
  const database = new Database(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma("query_only = ON");
    const actual = database.prepare(query).all();
    const normalize = (sql) =>
      (sql ?? "")
        .replace(/^CREATE TABLE "([A-Za-z_][A-Za-z0-9_]*)"/, "CREATE TABLE $1")
        .replace(/\s+/g, " ")
        .trim();
    const matches = (rows) =>
      rows.length === actual.length &&
      rows.every((row) =>
        actual.some(
          (found) =>
            found.type === row.type &&
            found.name === row.name &&
            normalize(found.sql) === normalize(row.sql),
        ),
      );
    const baseline = expected.filter((row) => !row.name.startsWith("image_"));
    const status = matches(expected)
      ? "current"
      : matches(baseline)
        ? "requires_explicit_image_upgrade"
        : "incompatible";
    const counts = Object.fromEntries(
      actual
        .filter((row) => row.type === "table")
        .map((row) => [
          row.name,
          database
            .prepare(
              'SELECT count(*) AS count FROM "' +
                row.name.replaceAll('"', '""') +
                '"',
            )
            .get().count,
        ]),
    );
    return {
      status,
      existingTables: actual.filter((row) => row.type === "table").length,
      targetTables: expectedTables.length,
      addedTables:
        status === "current"
          ? []
          : expectedTables.filter((name) => name.startsWith("image_")),
      rowCounts: counts,
      integrityCheck: database.pragma("integrity_check", { simple: true }),
      foreignKeyErrors: database.pragma("foreign_key_check").length,
      ddlSha256,
      migrationExecuted: false,
    };
  } finally {
    database.close();
  }
}
if (require.main === module) {
  try {
    if (process.argv.length > 3 || process.argv[2]?.startsWith("--"))
      throw Error(
        "Usage: node scripts/image-schema-preflight.cjs [database-file] (read-only)",
      );
    console.log(
      JSON.stringify(
        inspect(
          process.argv[2] ??
            path.resolve(process.cwd(), ".data/ai-workspace-v5.sqlite"),
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { inspect };
