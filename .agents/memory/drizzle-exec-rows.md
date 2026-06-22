---
name: drizzle-orm/node-postgres db.execute() returns QueryResult
description: Raw SQL via db.execute() returns a node-postgres QueryResult, not a plain array — must access .rows
---

## Rule
Never iterate or destructure `await db.execute(sql`...`)` directly as an array. Always wrap it with the `execRows<T>()` helper (or equivalent `.rows` access) when using `drizzle-orm/node-postgres`.

**Why:** `drizzle-orm/node-postgres` wraps the `pg` (node-postgres) driver. `db.execute()` returns a `QueryResult<T>` object (with `.rows: T[]`, `.rowCount`, `.command`, etc.), NOT a plain array. Trying to `.map()` or destructure `[first] = await db.execute(...)` will fail at runtime with `rows.map is not a function` or `(intermediate value) is not iterable`.

**How to apply:**
- Add a helper near the top of any route file that uses raw SQL:
  ```typescript
  async function execRows<T>(query: Parameters<typeof db.execute>[0]): Promise<T[]> {
    const result = await db.execute(query) as unknown as { rows: T[] };
    return result.rows ?? [];
  }
  ```
- Use `execRows<T>(sql`...`)` for all SELECT queries and any raw SQL that needs the result array.
- For UPDATEs/INSERTs where you don't need the result, you can still use `db.execute()` directly (return value ignored).
- Drizzle's query-builder methods (`db.select()`, `db.insert().returning()`, etc.) return plain arrays — this issue only affects raw `db.execute(sql`...`)` calls.
