/**
 * #1794 — Microsoft365DSC resource-map extractor.
 *
 * Each DSC resource directory holds three files this reads:
 *   settings.json          resource name, description, mode, required modules,
 *                          the read/update cmdlets per module, and — the part that
 *                          matters most here — the required APPLICATION (app-only)
 *                          permissions per workload.
 *   *.schema.mof           the resource's full property set: name, MOF type, whether
 *                          it is the Key, whether it is Required, and the ValueMap
 *                          enumerations. This is the property model.
 *   *.psm1                 read for literal Graph request URIs where the resource
 *                          talks to Graph directly, which gives a real Graph path
 *                          rather than only a cmdlet name.
 *
 * Attribution: Microsoft365DSC is community-maintained open source under MIT
 * (https://github.com/Microsoft365DSC/Microsoft365DSC). Only its factual map is
 * read; no code or content is copied into this product.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { workloadForDscResource, WORKLOAD_SURFACE } from "./sources.mjs";

/**
 * Eight of the 536 .schema.mof files are UTF-16LE with a BOM rather than UTF-8
 * (e.g. MSFT_AADAccessReviewPolicy). Reading those as UTF-8 yields NUL-interleaved
 * text and silently parses to zero properties, so decode by BOM, not by assumption.
 */
async function readText(file) {
  const buf = await readFile(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le").slice(1);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf);
    swapped.swap16();
    return swapped.toString("utf16le").slice(1);
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString("utf8").slice(1);
  return buf.toString("utf8");
}

/**
 * DSC parameters that configure the *connection* to the tenant, not the tenant. They
 * appear on nearly every resource and are not part of any configuration snapshot, so
 * they are flagged rather than counted as configuration properties.
 */
const CONNECTION_PARAMETERS = new Set([
  "Credential", "ApplicationId", "ApplicationSecret", "TenantId", "CertificateThumbprint",
  "CertificatePath", "CertificatePassword", "ManagedIdentity", "AccessTokens", "Ensure",
]);

/** Permission entries appear either as `{ "name": "X" }` or as a bare `"X"`. */
function permNames(list) {
  if (!Array.isArray(list)) return [];
  return list.map((p) => (typeof p === "string" ? p : p?.name)).filter(Boolean);
}

/**
 * Collapse the per-workload permissions block into flat read/update lists, keeping
 * the workload each permission came from so nothing is silently merged.
 */
function extractPermissions(permissions) {
  const application = { read: [], update: [] };
  const delegated = { read: [], update: [] };
  const roles = { read: [], update: [] };
  const byWorkload = {};

  for (const [workload, block] of Object.entries(permissions ?? {})) {
    const entry = { application: { read: [], update: [] }, delegated: { read: [], update: [] }, roles: { read: [], update: [] } };
    if (block?.application) {
      entry.application.read = permNames(block.application.read);
      entry.application.update = permNames(block.application.update);
    }
    if (block?.delegated) {
      entry.delegated.read = permNames(block.delegated.read);
      entry.delegated.update = permNames(block.delegated.update);
    }
    // Exchange / Purview express requirements as RBAC roles + role groups, not scopes.
    for (const key of ["requiredroles", "requiredRoles", "requiredrolegroups", "requiredRoleGroups"]) {
      const v = block?.[key];
      if (Array.isArray(v)) entry.roles.read.push(...v);
      else if (v && typeof v === "object") {
        entry.roles.read.push(...(v.read ?? []));
        entry.roles.update.push(...(v.update ?? []));
      }
    }
    byWorkload[workload] = entry;
    application.read.push(...entry.application.read);
    application.update.push(...entry.application.update);
    delegated.read.push(...entry.delegated.read);
    delegated.update.push(...entry.delegated.update);
    roles.read.push(...entry.roles.read);
    roles.update.push(...entry.roles.update);
  }

  const uniq = (a) => [...new Set(a)].sort();
  return {
    byWorkload,
    applicationRead: uniq(application.read),
    applicationUpdate: uniq(application.update),
    delegatedRead: uniq(delegated.read),
    delegatedUpdate: uniq(delegated.update),
    rolesRead: uniq(roles.read),
    rolesUpdate: uniq(roles.update),
    permissionWorkloads: Object.keys(permissions ?? {}),
  };
}

/**
 * Parse a DSC .schema.mof class body into the resource's property model.
 * MOF property lines look like:
 *   [Key, Description("...")] String DisplayName;
 *   [Write, Description("..."), ValueMap{"a","b"}, Values{"a","b"}] String State;
 *   [Write, ..., EmbeddedInstance("MSFT_Foo")] String Bar[];
 */
export function parseSchemaMof(mof) {
  const classMatch = /class\s+(MSFT_\w+)\s*:\s*OMI_BaseResource\s*\{([\s\S]*?)\n\};/.exec(mof)
    ?? /class\s+(MSFT_\w+)\s*:\s*OMI_BaseResource\s*\{([\s\S]*)\}/.exec(mof);
  if (!classMatch) return { className: null, properties: [] };
  const body = classMatch[2];
  const properties = [];
  const lineRe = /\[([^\]]*(?:\([^)]*\)[^\]]*)*)\]\s*(\w+)\s+(\w+)(\[\])?\s*;/g;
  let m;
  let ordinal = 0;
  while ((m = lineRe.exec(body))) {
    const qualifiers = m[1];
    const mofType = m[2];
    const name = m[3];
    const isCollection = !!m[4];
    const desc = /Description\("((?:[^"\\]|\\.)*)"\)/.exec(qualifiers);
    const valueMap = /ValueMap\{([^}]*)\}/.exec(qualifiers);
    const embedded = /EmbeddedInstance\("([^"]+)"\)/.exec(qualifiers);
    properties.push({
      name,
      mofType,
      isCollection,
      isKey: /(^|,)\s*Key\b/.test(qualifiers),
      isRequired: /(^|,)\s*Required\b/.test(qualifiers),
      isWrite: /(^|,)\s*Write\b/.test(qualifiers),
      isRead: /(^|,)\s*Read\b/.test(qualifiers),
      allowedValues: valueMap
        ? valueMap[1].split(",").map((v) => v.trim().replace(/^"|"$/g, "")).filter((v) => v !== "")
        : [],
      embeddedInstance: embedded ? embedded[1] : null,
      description: desc ? desc[1].replace(/\\"/g, '"') : null,
      isConnectionParameter: CONNECTION_PARAMETERS.has(name),
      ordinal: ordinal++,
    });
  }
  return { className: classMatch[1], properties };
}

/**
 * Read cmdlets a resource's psm1 actually invokes.
 *
 * The `commands` block in settings.json is populated for the Graph-backed resources
 * but is null for every Exchange and Purview one (142 resources), whose real cmdlets
 * appear only in the module body. Without this, the whole Exchange workload has no
 * cmdlet in the model and every Exchange monitor check reads as unmatched.
 *
 * Excludes DSC's own scaffolding (Get-TargetResource, Export-ModuleMember, ...) and
 * the Microsoft365DSC/MSCloudLogin helpers, which are plumbing, not tenant reads.
 */
const CMDLET_NOISE = /^(Get|Export)-(TargetResource|Command|Module|ModuleMember|Content|Date|Random|Credential|Item|ChildItem|Variable|Member|PSSession|Culture|Location|Host|Process|Unique|CimInstance|TypeData|CompareParameters|M365TenantId)$/;
export function extractInvokedReadCmdlets(psm1) {
  const found = new Set();
  for (const m of psm1.matchAll(/\b((?:Get|Export)-[A-Z][A-Za-z0-9]+)\b/g)) {
    const c = m[1];
    if (CMDLET_NOISE.test(c)) continue;
    if (/^(Get|Export)-(M365DSC|MSCloudLogin|MgGraphRequest)/.test(c)) continue;
    found.add(c);
  }
  return [...found].sort();
}

/** Literal Graph request paths a resource's psm1 issues, e.g. "/beta/deviceManagement/x". */
export function extractGraphPaths(psm1) {
  const paths = new Set();
  // Relative form used with Invoke-MgGraphRequest: "/beta/..." or "/v1.0/..."
  for (const m of psm1.matchAll(/["']\/(beta|v1\.0)\/([A-Za-z0-9_\/\-]*)/g)) {
    const raw = `/${m[2]}`.replace(/\/+$/, "");
    if (raw.length > 1) paths.add({ version: m[1], path: raw });
  }
  // $Script:BaseUrl = '/beta/...' pattern used by the Intune resources.
  for (const m of psm1.matchAll(/\$Script:BaseUrl\s*=\s*["']\/(beta|v1\.0)\/([A-Za-z0-9_\/\-]+)["']/g)) {
    paths.add({ version: m[1], path: `/${m[2]}` });
  }
  // Absolute form.
  for (const m of psm1.matchAll(/https:\/\/graph\.microsoft\.com\/(beta|v1\.0)\/([A-Za-z0-9_\/\-]+)/g)) {
    paths.add({ version: m[1], path: `/${m[2]}` });
  }
  // De-duplicate on version+path (Set of objects would not).
  const seen = new Map();
  for (const p of paths) seen.set(`${p.version}${p.path}`, p);
  return [...seen.values()];
}

/** Read cmdlets the resource declares (Get-, Export- and Test- verbs), flattened across modules. */
function readCmdlets(commands) {
  const all = [];
  for (const c of commands ?? []) {
    for (const cmd of c.cmdlets ?? []) all.push({ module: c.module, cmdlet: cmd });
  }
  return all;
}

/**
 * Extract every resource from an extracted Microsoft365DSC tree.
 * @param {string} treeRoot directory the tarball was extracted into
 */
export async function extractM365DscResources(treeRoot) {
  const dirs = await findResourceDirs(treeRoot);
  const resources = [];
  for (const dir of dirs) {
    const files = await readdir(dir);
    const settingsFile = files.find((f) => f === "settings.json");
    if (!settingsFile) continue;
    const settings = JSON.parse(await readText(path.join(dir, settingsFile)));
    // The resource's own directory (DscResources/MSFT_<Name>/) is Microsoft365DSC's
    // structural identity for the resource and is authoritative. settings.json's own
    // `resourceName` field has been observed to hold the literal, un-templated string
    // "ResourceName" instead of a real value for at least one resource
    // (MSFT_EXOAtpProtectionPolicyRule, Git #2007) — trusting it blindly silently
    // corrupts that resource's identity (resource_key, display_name, m365dsc_resource
    // all became the literal placeholder). Derive from the directory name first and
    // only fall back to settings.json's value if the directory isn't MSFT_-prefixed
    // (shouldn't happen in practice, but the parser must not throw over it).
    const dirResourceName = path.basename(dir).replace(/^MSFT_/, "");
    const settingsResourceName = settings.resourceName;
    const resourceName = dirResourceName || settingsResourceName;
    if (!resourceName) continue;
    if (settingsResourceName && settingsResourceName !== resourceName) {
      console.warn(
        `  ! settings.json resourceName ("${settingsResourceName}") disagrees with directory name ` +
        `("${resourceName}") for ${path.basename(dir)} — using the directory name`,
      );
    }

    const mofFile = files.find((f) => f.endsWith(".schema.mof"));
    const psm1File = files.find((f) => f.endsWith(".psm1"));
    const mof = mofFile ? parseSchemaMof(await readText(path.join(dir, mofFile))) : { className: null, properties: [] };
    const psm1 = psm1File ? await readText(path.join(dir, psm1File)) : "";
    const graphPaths = psm1 ? extractGraphPaths(psm1) : [];
    const invokedCmdlets = psm1 ? extractInvokedReadCmdlets(psm1) : [];

    const cmdlets = readCmdlets(settings.commands);
    const perms = extractPermissions(settings.permissions);
    const workload = workloadForDscResource(resourceName);

    resources.push({
      resourceName,
      workload,
      surface: WORKLOAD_SURFACE[workload] ?? "other",
      description: settings.description ?? null,
      mode: settings.mode ?? null,
      supportedEnvironments: settings.supportedEnvironments ?? [],
      requiredModules: settings.requiredModules ?? [],
      cmdlets,
      // Declared cmdlets first (they carry a module attribution), then the ones only
      // observable in the module body — deduplicated, both are real read transports.
      readCmdlets: [...new Set([
        ...cmdlets.filter((c) => /^(Get|Export|Test)-/i.test(c.cmdlet)).map((c) => c.cmdlet),
        ...invokedCmdlets,
      ])],
      declaredReadCmdlets: cmdlets.filter((c) => /^(Get|Export|Test)-/i.test(c.cmdlet)).map((c) => c.cmdlet),
      invokedCmdlets,
      graphPaths,
      mofClass: mof.className,
      properties: mof.properties,
      ...perms,
      sourceDir: path.relative(treeRoot, dir).replace(/\\/g, "/"),
    });
  }
  resources.sort((a, b) => a.resourceName.localeCompare(b.resourceName));
  return resources;
}

async function findResourceDirs(root) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const full = path.join(dir, e.name);
      if (e.name === "DscResources" || e.name === "DSCResources") {
        for (const r of await readdir(full, { withFileTypes: true })) {
          if (r.isDirectory()) out.push(path.join(full, r.name));
        }
        continue;
      }
      await walk(full, depth + 1);
    }
  }
  await walk(root, 0);
  return out.sort();
}
