// scripts/db/pg-cli.mjs
//
// Git #4436: the psql / pg_dump call sites in these scripts used to pass the
// full DATABASE_URL -- password included -- as a command-line argument. Any
// failure then surfaced Node's `Command failed: pg_dump postgresql://user:<pw>@...`
// message, and the Command Center pane showed it verbatim.
//
// pgCli() splits a connection string into a password-free conninfo URL (safe
// in argv, safe in any error message) and a child-process env that carries the
// password as PGPASSWORD, which libpq reads when the conninfo has none.
// redactConnectionSecrets() is the defense-in-depth layer for anything that
// still gets printed.

// Returns { conninfo, env } for execFileSync/spawnSync: pass `conninfo` where
// the URL used to go, and `env` as the child's environment.
export function pgCli(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const password = decodeURIComponent(parsed.password);
  const queryPassword = parsed.searchParams.get("password");
  parsed.password = "";
  parsed.searchParams.delete("password");

  const env = { ...process.env };
  const effectivePassword = password || queryPassword;
  if (effectivePassword) env.PGPASSWORD = effectivePassword;
  return { conninfo: parsed.toString(), env };
}

// Strips credentials from any text before it is printed: the userinfo part of
// any scheme://user:pw@host URL (user and password both, replaced with a
// marker -- host/port/db stay readable), plus password=... conninfo keywords
// and PGPASSWORD=... assignments.
export function redactConnectionSecrets(text) {
  return String(text)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s]*@/gi, "$1<credentials-redacted>@")
    .replace(/\b(password|PGPASSWORD)(\s*=\s*)(?:'[^']*'|"[^"]*"|[^\s&;]+)/gi, "$1$2<redacted>");
}
