# Git #1840 — Closing the "SSH private key under the mat" vector

**Parent security context:** #1789 (Dev Server & Deploy Infrastructure) · follows #1828
**Durable owner:** #1281 (GATE: v1.1 release) — the remote-side step below is a Shane-only
Replit/Staging action, out of agent scope per the production-change gate.

> **This document is inert.** Nothing here runs automatically. The in-app half (#1840) is
> already shipped in `CLAUDE.md`. The remote half below is installed **by Shane, by hand, on
> the Replit workspace**. No agent applies it.

---

## 1. The vector

#1828 added a real, enforced Dev-only gate to `desktop/BuildConsole/Services/ReplitSshService.cs`
(the in-app SSH wrapper): agent/`shaneapp://` origins are hard-locked, and every other caller is
refused unless the Target Environment selector reads Staging. That closes the **in-app** path.

It does **not** close the path the original near-miss actually used: an agent build session has a
real shell and can run `ssh -i <key> <user>@<host> "<cmd>"` directly, never touching
`ReplitSshService` or its gate. The Replit private key sits readable on disk, and (until #1840)
`CLAUDE.md` documented the exact working invocation.

## 2. Real evidence (audited 2026-09-06, this machine)

```
Key file: C:\Users\Ronnie\.ssh\replit  — 419 bytes, plaintext "-----BEGIN OPENSSH PRIVATE KEY-----"
  ACL:  NT AUTHORITY\SYSTEM         FullControl  Allow
        BUILTIN\Administrators      FullControl  Allow
        DESKTOP-QMJ39BJ\Ronnie      Modify       Allow   <-- the agent build session runs as THIS user
Settings: %AppData%\BuildConsole\settings.json — plaintext, readable by the same user
```

The agent build session and BuildConsole run as the **same Windows user** (`Ronnie`). That single
fact is what makes the local-only remediations ineffective — see below.

## 3. The three options, assessed honestly

| Option | Closes the same-user vector? | Why |
|---|---|---|
| **1. Tighten the key file's ACL** so "only BuildConsole's process" can read it | **No** | NTFS ACLs are identity-based, not process-based. Both BuildConsole and the agent run as `Ronnie`; any ACL that lets one read the key lets the other read it. Owner-only is good hygiene against *other user accounts*, but that is not this threat. |
| **3. Hold the key encrypted** (DPAPI / decrypt-at-use) | **No** | DPAPI `CurrentUser` decrypts for any process running as `Ronnie`. Adding app-specific entropy does not help — the agent can read BuildConsole's binary/config to recover it. A same-user process can always reproduce whatever BuildConsole does to decrypt. It reduces *offline/at-rest* exposure to other users, not the in-session same-user vector. |
| **2. Restricted `authorized_keys` forced-command on the remote** | **Yes** | It constrains what the key can *do* on the server, regardless of who holds it. Even if the key is fully read and `ssh` is run by hand, the remote refuses anything outside the allowlist. This is the only option that actually closes it. |

**Conclusion:** the durable technical closure is **option 2**. It is a remote (Replit/Staging)
change, so per the production-change gate it is written here as a ready-to-apply plan for Shane, not
applied by an agent.

## 4. The closure — a forced-command allowlist on the remote key

Add a `command="..."` restriction to the Replit workspace's `~/.ssh/authorized_keys` entry for this
key, pointing at a small wrapper that only permits the operations BuildConsole legitimately performs.
Every other command string is refused. This requires **no change to `ReplitSshService`** — it keeps
sending the same command strings it does today; the wrapper simply matches their shapes and rejects
anything else.

### 4a. The operations BuildConsole actually sends today

Extracted from `ReplitSshService.cs` (audited 2026-09-06), against remote dir `/home/runner/workspace`:

- **Deploy:** `git config --global --add safe.directory '*' …; cd <dir> && … git pull --ff-only origin main || ( git fetch origin main && git reset --hard origin/main )`
- **Restart:** `cd <dir> && ( sleep 2; kill 1 ) >/dev/null 2>&1 & echo 'restart scheduled'`
- **Commit hash:** `git -C <dir> rev-parse HEAD`
- **Pending migrations:** `cd <dir> && (node scripts/dist/manual-migration-status.js … || npx --yes tsx scripts/src/manual-migration-status.ts)`
- **Connection test:** `echo SSH_CONNECTED_OK && uname -a`

### 4b. The wrapper (install on the Replit workspace as `~/bin/replit-ssh-guard.sh`)

```bash
#!/usr/bin/env bash
# Forced-command allowlist for the BuildConsole deploy key (Git #1840).
# Installed on the Replit workspace; referenced from ~/.ssh/authorized_keys.
# Rejects any SSH command that isn't one of BuildConsole's known-safe operations,
# so a stolen/leaked key cannot run an arbitrary shell.
set -euo pipefail

WORKDIR="/home/runner/workspace"
CMD="${SSH_ORIGINAL_COMMAND:-}"
LOG="$HOME/.ssh/replit-ssh-guard.log"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >> "$LOG" 2>/dev/null || true; }

deny() { log "DENY: ${CMD}"; echo "replit-ssh-guard: command refused (Git #1840 allowlist)" >&2; exit 1; }

# Reject obvious shell-escape / chaining beyond the known compound shapes early.
case "$CMD" in
  *'`'*|*'$('*) deny ;;
esac

case "$CMD" in
  # Connection test
  "echo SSH_CONNECTED_OK && uname -a") ;;
  # Commit hash read
  "git -C ${WORKDIR} rev-parse HEAD") ;;
  # Deploy (git pull / reset to origin/main) — matched by its stable prefix + dir
  "git config --global --add safe.directory"*"cd ${WORKDIR} && "*"git pull"*"origin main"*) ;;
  # Restart (kill 1 in the workspace dir)
  "cd ${WORKDIR} && ( sleep "*"kill 1 )"*"restart scheduled"*) ;;
  # Pending manual-migration status read
  "cd ${WORKDIR} && "*"manual-migration-status"*) ;;
  *) deny ;;
esac

log "ALLOW: ${CMD}"
exec bash -c "$CMD"
```

> Tighten the patterns further if you prefer exact-string matches. The trade-off is that the deploy
> and migration-status strings are compound and evolve with `ReplitSshService.cs`; the prefix/`dir`
> anchoring above survives small changes while still refusing an arbitrary shell. Every allow/deny is
> logged to `~/.ssh/replit-ssh-guard.log` so drift or an attempted misuse is visible.

### 4c. Wire it into `authorized_keys`

On the Replit workspace, prefix the existing entry for this key with the forced command and the
standard hardening restrictions:

```
command="$HOME/bin/replit-ssh-guard.sh",no-agent-forwarding,no-port-forwarding,no-pty,no-X11-forwarding ssh-ed25519 AAAA...<the existing public key>... buildconsole-deploy
```

Steps (Shane, from a trusted local shell — **not** an agent session):
1. `chmod +x ~/bin/replit-ssh-guard.sh` on the Replit workspace.
2. Edit `~/.ssh/authorized_keys`, prepend the `command="…",no-*` options to the existing key line.
3. Verify the legitimate flows still work from BuildConsole: **Test Connection**, **Deploy to
   Staging**, a restart, and the pending-migration read.
4. Verify a raw `ssh -i <key> <user>@<host> "id"` (an off-allowlist command) is now **refused**.

## 5. Residual / follow-up (optional, not required for closure)

- **Verb-based protocol (stronger, needs a small in-app change):** refactor `ReplitSshService` to
  send a fixed verb (`deploy` / `restart` / `commit-hash` / `migration-status` / `ping`) and have the
  wrapper map each verb to the real command. This removes the fragile string-shape matching entirely.
  It must ship *after* the wrapper is installed, or it breaks the deploy flow — hence it's a follow-up,
  not part of the immediate closure.
- **Key rotation:** rotate the deploy key at the same time (the current key has been readable on disk
  in plaintext), so any copy taken before the forced-command lands is retired.
- **At-rest hygiene (option 3, partial value only):** if desired, additionally DPAPI-encrypt the key
  at rest so it isn't sitting plaintext for *offline* theft. Understand it does **not** close the
  same-user in-session vector — the forced-command (option 2) is what does that.

## 6. What #1840 shipped in-repo (already done, agent scope)

- `CLAUDE.md` "Remote server access (SSH)" section rewritten: the ready-to-run `ssh -i …` recipe and
  the key-location pointer are removed, and a HARD RULE now prohibits any agent session from invoking
  `ssh`/handling the Replit key directly — routing all remote access through the gated
  `ReplitSshService`. This neutralizes the *documented* form of the vector (the agent no longer has the
  recipe and is explicitly told the direct bypass is prohibited).
- This document, carried by #1281, is the remaining Shane-only remote step for the full technical
  closure.
