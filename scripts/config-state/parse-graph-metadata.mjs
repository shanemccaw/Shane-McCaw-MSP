/**
 * #1794 — CSDL ($metadata) parser for Microsoft Graph.
 *
 * Graph publishes OData v4 CSDL: a flat, extremely regular XML document (one line,
 * ~4 MB for beta). A scanning parser over the element grammar is both sufficient and
 * far cheaper than pulling in a DOM parser, and it is exact for this grammar because
 * CSDL elements never nest their own tag names ambiguously.
 *
 * Produces:
 *   - types:      every EntityType / ComplexType / EnumType, with its property set
 *   - container:  the EntityContainer's EntitySets and Singletons
 *   - paths:      real addressable configuration paths, walked from the container
 *                 roots through containment navigation properties
 *
 * No network access here — reads the file the fetch step cached.
 */
import { readFile } from "node:fs/promises";
import { CONFIG_SURFACE_ROOTS, EXCLUDED_ROOTS, EXCLUDED_PATH_SEGMENTS } from "./sources.mjs";

const ATTR_RE = /([A-Za-z:]+)="([^"]*)"/g;

function attrs(tag) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(tag))) out[m[1]] = m[2];
  return out;
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

/** `Collection(graph.foo)` -> { type: "graph.foo", isCollection: true } */
function unwrapCollection(type) {
  const m = /^Collection\((.+)\)$/.exec(type ?? "");
  return m ? { type: m[1], isCollection: true } : { type: type ?? "", isCollection: false };
}

/**
 * Parse one $metadata document.
 * @param {string} xml raw CSDL
 * @param {string} graphVersion "v1.0" | "beta"
 */
export function parseGraphMetadata(xml, graphVersion) {
  /** @type {Map<string, any>} qualifiedName -> type */
  const types = new Map();
  const aliasByNamespace = new Map();
  const namespaceByAlias = new Map();

  // ── Pass 1: schemas, aliases, and every type with its properties ────────────
  const schemaRe = /<Schema\s+([^>]*?)>/g;
  const schemaStarts = [];
  let sm;
  while ((sm = schemaRe.exec(xml))) schemaStarts.push({ index: sm.index, end: schemaRe.lastIndex, a: attrs(sm[1]) });

  for (let i = 0; i < schemaStarts.length; i++) {
    const { end, a } = schemaStarts[i];
    const ns = a.Namespace;
    const alias = a.Alias || null;
    if (alias) {
      aliasByNamespace.set(ns, alias);
      // `self` is re-used by several schemas; last-wins is wrong, so only the first
      // binding is kept globally and per-schema resolution (below) handles the rest.
      if (!namespaceByAlias.has(alias)) namespaceByAlias.set(alias, ns);
    }
    const bodyEnd = i + 1 < schemaStarts.length ? schemaStarts[i + 1].index : xml.length;
    const body = xml.slice(end, bodyEnd);
    parseSchemaBody(body, ns, alias, graphVersion, types);
  }

  // ── Pass 2: bound Functions ─────────────────────────────────────────────────
  // OData draws a hard line the model relies on: a Function is side-effect-free and
  // GET-addressable; an Action mutates and is POST-only. Only Functions are read
  // transports, so only Functions are collected — Actions are never emitted, which
  // is what keeps a "read the tenant's config" model from ever suggesting a write.
  const functions = [];
  {
    const re = /<Function Name="([^"]+)"([^>]*)>([\s\S]*?)<\/Function>/g;
    let m;
    while ((m = re.exec(xml))) {
      const head = attrs(m[2]);
      if (head.IsBound !== "true") continue;
      const firstParam = /<Parameter Name="[^"]*" Type="([^"]+)"/.exec(m[3]);
      if (!firstParam) continue;
      const { type: bindsTo, isCollection } = unwrapCollection(firstParam[1]);
      const ret = /<ReturnType Type="([^"]+)"/.exec(m[3]);
      functions.push({
        name: m[1],
        bindsTo,
        bindsToCollection: isCollection,
        returnType: ret ? ret[1] : null,
        isComposable: head.IsComposable === "true",
      });
    }
  }

  // ── Pass 3: the EntityContainer ─────────────────────────────────────────────
  const container = [];
  const cStart = xml.indexOf("<EntityContainer");
  if (cStart !== -1) {
    const cBody = xml.slice(cStart, xml.indexOf("</EntityContainer>", cStart));
    const re = /<(EntitySet|Singleton)\s+([^>]*?)\/?>/g;
    let m;
    while ((m = re.exec(cBody))) {
      const a = attrs(m[2]);
      const raw = a.EntityType ?? a.Type;
      if (!a.Name || !raw) continue;
      container.push({ kind: m[1], name: a.Name, type: raw });
    }
  }

  /** Resolve an alias-qualified or fully-qualified type reference to a known type. */
  function resolveType(ref, contextNamespace) {
    if (!ref) return null;
    if (types.has(ref)) return types.get(ref);
    const dot = ref.lastIndexOf(".");
    if (dot === -1) return null;
    const prefix = ref.slice(0, dot);
    const name = ref.slice(dot + 1);
    // `self` always means the schema the reference appears in.
    if (prefix === "self" && contextNamespace) {
      const q = `${contextNamespace}.${name}`;
      if (types.has(q)) return types.get(q);
    }
    const ns = namespaceByAlias.get(prefix);
    if (ns && types.has(`${ns}.${name}`)) return types.get(`${ns}.${name}`);
    return null;
  }

  return { graphVersion, types, container, functions, resolveType, namespaceByAlias, aliasByNamespace };
}

function parseSchemaBody(body, ns, alias, graphVersion, types) {
  const typeRe = /<(EntityType|ComplexType|EnumType)\s+([^>]*?)(\/)?>/g;
  let m;
  const found = [];
  while ((m = typeRe.exec(body))) {
    found.push({ kind: m[1], a: attrs(m[2]), selfClosing: !!m[3], bodyStart: typeRe.lastIndex });
  }

  for (const t of found) {
    const name = t.a.Name;
    if (!name) continue;
    const qualifiedName = `${ns}.${name}`;
    let inner = "";
    if (!t.selfClosing) {
      const close = `</${t.kind}>`;
      const closeAt = body.indexOf(close, t.bodyStart);
      inner = closeAt === -1 ? "" : body.slice(t.bodyStart, closeAt);
    }

    const record = {
      graphVersion,
      namespace: ns,
      alias,
      name,
      qualifiedName,
      kind: t.kind === "EntityType" ? "entityType" : t.kind === "ComplexType" ? "complexType" : "enumType",
      baseType: t.a.BaseType ?? null,
      isAbstract: t.a.Abstract === "true",
      isOpenType: t.a.OpenType === "true",
      keyProperties: [],
      properties: [],
      enumMembers: [],
    };

    if (record.kind === "enumType") {
      const mre = /<Member\s+([^>]*?)\/?>/g;
      let mm;
      while ((mm = mre.exec(inner))) {
        const a = attrs(mm[1]);
        if (a.Name) record.enumMembers.push({ name: a.Name, value: a.Value ?? null });
      }
    } else {
      const keyBlock = /<Key>([\s\S]*?)<\/Key>/.exec(inner);
      if (keyBlock) {
        const kre = /<PropertyRef\s+([^>]*?)\/?>/g;
        let km;
        while ((km = kre.exec(keyBlock[1]))) {
          const a = attrs(km[1]);
          if (a.Name) record.keyProperties.push(a.Name);
        }
      }
      let ordinal = 0;
      const pre = /<(Property|NavigationProperty)\s+([^>]*?)\/?>/g;
      let pm;
      while ((pm = pre.exec(inner))) {
        const a = attrs(pm[2]);
        if (!a.Name || !a.Type) continue;
        const { type, isCollection } = unwrapCollection(a.Type);
        record.properties.push({
          name: a.Name,
          kind: pm[1] === "Property" ? "property" : "navigationProperty",
          edmType: type,
          isCollection,
          isNullable: a.Nullable !== "false",
          containsTarget: a.ContainsTarget === "true",
          description: a.Description ? decodeXml(a.Description) : null,
          ordinal: ordinal++,
        });
      }
    }

    types.set(qualifiedName, record);
  }
}

/** All properties of a type including everything inherited from its BaseType chain. */
export function effectiveProperties(model, type, seen = new Set()) {
  if (!type || seen.has(type.qualifiedName)) return [];
  seen.add(type.qualifiedName);
  const base = type.baseType ? model.resolveType(type.baseType, type.namespace) : null;
  return [...effectiveProperties(model, base, seen), ...type.properties];
}

/**
 * Walk the EntityContainer into real addressable configuration paths.
 *
 * Rule, chosen so the result is bounded and every path is genuinely addressable:
 *  - every included top-level EntitySet / Singleton is emitted as a resource;
 *  - a *singleton-shaped* root (a container type: single-valued, e.g. `policies`)
 *    is recursed into, because the configuration objects hang off it;
 *  - each containment navigation property is emitted as a resource path;
 *  - recursion continues only through SINGLE-VALUED containment nav properties
 *    (`/policies/crossTenantAccessPolicy/...`) — a collection-valued one is the
 *    resource itself, and recursing into it would only produce per-item paths.
 */
export function expandConfigPaths(model, { maxDepth = 4 } = {}) {
  const out = [];
  const seenPaths = new Set();

  function emit(row) {
    if (seenPaths.has(row.path)) return;
    seenPaths.add(row.path);
    out.push(row);
  }

  function walk(prefix, type, depth, surface, rootName) {
    if (!type || depth > maxDepth) return;
    for (const p of effectiveProperties(model, type)) {
      if (p.kind !== "navigationProperty") continue;
      if (EXCLUDED_PATH_SEGMENTS.has(p.name)) continue;
      // Only containment navigation is addressable directly under the parent path.
      if (!p.containsTarget) continue;
      const target = model.resolveType(p.edmType, type.namespace);
      const childPath = `${prefix}/${p.name}`;
      emit({
        path: childPath,
        rootName,
        surface,
        isCollection: p.isCollection,
        entityTypeRef: p.edmType,
        entityType: target ? target.qualifiedName : null,
        depth,
        containerKind: "navigation",
      });
      if (!p.isCollection && target && target.kind === "entityType") {
        walk(childPath, target, depth + 1, surface, rootName);
      }
    }
  }

  for (const entry of model.container) {
    const surface = CONFIG_SURFACE_ROOTS[entry.name];
    if (!surface) continue; // excluded, or not part of the configuration surface
    const type = model.resolveType(entry.type, "microsoft.graph");
    emit({
      path: `/${entry.name}`,
      rootName: entry.name,
      surface,
      isCollection: entry.kind === "EntitySet",
      entityTypeRef: entry.type,
      entityType: type ? type.qualifiedName : null,
      depth: 0,
      containerKind: entry.kind === "EntitySet" ? "entitySet" : "singleton",
    });
    if (entry.kind === "Singleton" && type) walk(`/${entry.name}`, type, 1, surface, entry.name);
  }

  // Bound Functions become read paths on the container they bind to. This is what
  // makes the usage/adoption reporting surface (`/reports/getEmailActivityUserDetail`)
  // a first-class resource instead of collapsing onto the bare `/reports` root.
  const singletonsByType = new Map();
  for (const entry of model.container) {
    if (entry.kind !== "Singleton") continue;
    const surface = CONFIG_SURFACE_ROOTS[entry.name];
    if (!surface) continue;
    const t = model.resolveType(entry.type, "microsoft.graph");
    if (t && !singletonsByType.has(t.qualifiedName)) singletonsByType.set(t.qualifiedName, { entry, surface });
  }
  for (const fn of model.functions) {
    if (fn.bindsToCollection) continue; // bound to a collection -> per-item, not a config read
    const target = model.resolveType(fn.bindsTo, "microsoft.graph");
    if (!target) continue;
    const host = singletonsByType.get(target.qualifiedName);
    if (!host) continue;
    emit({
      path: `/${host.entry.name}/${fn.name}`,
      rootName: host.entry.name,
      surface: host.surface,
      isCollection: /^Collection\(/.test(fn.returnType ?? ""),
      entityTypeRef: fn.returnType,
      entityType: model.resolveType(unwrapCollection(fn.returnType).type, target.namespace)?.qualifiedName ?? null,
      depth: 1,
      containerKind: "function",
    });
  }

  return out;
}

export async function loadGraphModel(file, graphVersion) {
  const xml = await readFile(file, "utf8");
  return parseGraphMetadata(xml, graphVersion);
}

export { EXCLUDED_ROOTS };
