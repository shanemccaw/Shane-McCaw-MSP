/* @ds-bundle: {"format":4,"namespace":"ShaneMcCawMSPDesignSystem_253148","components":[{"name":"Alert","sourcePath":"components/core/Alert.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"CardHeader","sourcePath":"components/core/Card.jsx"},{"name":"CardTitle","sourcePath":"components/core/Card.jsx"},{"name":"CardDescription","sourcePath":"components/core/Card.jsx"},{"name":"CardContent","sourcePath":"components/core/Card.jsx"},{"name":"CardFooter","sourcePath":"components/core/Card.jsx"},{"name":"Input","sourcePath":"components/core/Input.jsx"},{"name":"Label","sourcePath":"components/core/Input.jsx"},{"name":"EngineCard","sourcePath":"components/marketing/EngineCard.jsx"},{"name":"Eyebrow","sourcePath":"components/marketing/Eyebrow.jsx"},{"name":"Logo","sourcePath":"components/marketing/Logo.jsx"},{"name":"ServiceCard","sourcePath":"components/marketing/ServiceCard.jsx"},{"name":"StatCard","sourcePath":"components/marketing/StatCard.jsx"}],"sourceHashes":{"components/core/Alert.jsx":"da5dab786b4b","components/core/Badge.jsx":"28ab296f9449","components/core/Button.jsx":"84477df66781","components/core/Card.jsx":"0ffa2473898c","components/core/Input.jsx":"e80d10c190bf","components/marketing/EngineCard.jsx":"67e9cb6c67e2","components/marketing/Eyebrow.jsx":"4dcfbc560b00","components/marketing/Logo.jsx":"a3749eababc5","components/marketing/ServiceCard.jsx":"a635a5752129","components/marketing/StatCard.jsx":"336f9f98929e"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ShaneMcCawMSPDesignSystem_253148 = window.ShaneMcCawMSPDesignSystem_253148 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Alert.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-alert{display:flex;gap:.75rem;padding:1rem;border-radius:var(--radius-lg);
  border:1px solid;font-family:var(--font-sans);align-items:flex-start}
.smc-alert svg{width:1.125rem;height:1.125rem;flex-shrink:0;margin-top:.05rem}
.smc-alert-body{display:flex;flex-direction:column;gap:.15rem}
.smc-alert-title{font-weight:var(--weight-semibold);font-size:var(--text-sm);line-height:1.3}
.smc-alert-desc{font-size:var(--text-sm);line-height:1.45;opacity:.9}
.smc-alert--info{background:hsl(var(--primary)/.08);border-color:hsl(var(--primary)/.25);color:hsl(var(--primary))}
.smc-alert--success{background:hsl(var(--success)/.1);border-color:hsl(var(--success)/.3);color:hsl(var(--success))}
.smc-alert--warning{background:hsl(var(--warning)/.12);border-color:hsl(var(--warning)/.3);color:hsl(var(--warning))}
.smc-alert--destructive{background:hsl(var(--destructive)/.1);border-color:hsl(var(--destructive)/.3);color:hsl(var(--destructive))}
`;
/** Inline feedback banner (form errors, notices). Provide `icon`, `title`, children. */
function Alert({
  variant = "info",
  icon,
  title,
  className = "",
  children,
  ...props
}) {
  useStyle("smc-alert", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "alert",
    className: `smc-alert smc-alert--${variant} ${className}`.trim()
  }, props), icon, /*#__PURE__*/React.createElement("div", {
    className: "smc-alert-body"
  }, title && /*#__PURE__*/React.createElement("div", {
    className: "smc-alert-title"
  }, title), children && /*#__PURE__*/React.createElement("div", {
    className: "smc-alert-desc"
  }, children)));
}
Object.assign(__ds_scope, { Alert });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Alert.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-badge{display:inline-flex;align-items:center;white-space:nowrap;gap:.375rem;
  font-family:var(--font-sans);font-weight:var(--weight-semibold);font-size:var(--text-xs);
  line-height:1;padding:.25rem .625rem;border-radius:var(--radius-md);border:1px solid transparent;
  position:relative;z-index:0}
.smc-badge svg{width:.875rem;height:.875rem;flex-shrink:0}
.smc-badge--primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground));box-shadow:var(--shadow-xs)}
.smc-badge--secondary{background:hsl(var(--secondary));color:hsl(var(--secondary-foreground))}
.smc-badge--destructive{background:hsl(var(--destructive));color:hsl(var(--destructive-foreground));box-shadow:var(--shadow-xs)}
.smc-badge--outline{color:inherit;border-color:var(--badge-outline)}
/* Soft "signal" badges — tinted bg + matching border + colored text (marketing style) */
.smc-badge--soft{border-radius:var(--radius-full);padding:.3rem .75rem;font-weight:var(--weight-semibold)}
`;
const SOFT = {
  blue: ["#3b82f6"],
  teal: ["#00B4D8"],
  violet: ["#8b5cf6"],
  red: ["#ef4444"],
  emerald: ["#10b981"],
  amber: ["#f59e0b"],
  yellow: ["#eab308"],
  indigo: ["#6366f1"]
};
/**
 * Badge / tag. `variant` covers the solid shadcn set; `tone` (with variant="soft")
 * renders the tinted pill used for signal-engine + category labels.
 */
function Badge({
  variant = "primary",
  tone = "blue",
  className = "",
  style,
  children,
  ...props
}) {
  useStyle("smc-badge", CSS);
  let extra = style || {};
  if (variant === "soft") {
    const c = (SOFT[tone] || SOFT.blue)[0];
    extra = {
      ...extra,
      color: c,
      background: `${c}1a`,
      borderColor: `${c}33`
    };
  }
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `smc-badge smc-badge--${variant} ${className}`.trim(),
    style: extra
  }, props), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* Injects component CSS once (hover/active elevate overlays can't be inline). */
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-btn{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;white-space:nowrap;
  font-family:var(--font-sans);font-weight:var(--weight-medium);border-radius:var(--radius-md);
  position:relative;z-index:0;cursor:pointer;transition:background-color .15s,color .15s,box-shadow .15s;
  border:1px solid transparent;user-select:none;text-decoration:none}
.smc-btn:focus-visible{outline:none;box-shadow:0 0 0 2px hsl(var(--ring))}
.smc-btn:disabled,.smc-btn[aria-disabled=true]{pointer-events:none;opacity:.5}
.smc-btn svg{width:1rem;height:1rem;flex-shrink:0;pointer-events:none}
.smc-btn::after{content:"";position:absolute;inset:-1px;border-radius:inherit;pointer-events:none;z-index:2}
.smc-btn:hover::after{background:var(--elevate-1)}
.smc-btn:active::after{background:var(--elevate-2)}
/* sizes */
.smc-btn--default{min-height:2.25rem;padding:.5rem 1rem;font-size:var(--text-sm)}
.smc-btn--sm{min-height:2rem;padding:0 .75rem;font-size:var(--text-xs)}
.smc-btn--lg{min-height:2.5rem;padding:0 2rem;font-size:var(--text-sm)}
.smc-btn--icon{height:2.25rem;width:2.25rem;padding:0}
/* variants */
.smc-btn--primary{background:hsl(var(--primary));color:hsl(var(--primary-foreground));border-color:var(--primary-border,hsl(var(--primary)))}
.smc-btn--secondary{background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));border-color:var(--secondary-border,hsl(var(--secondary)))}
.smc-btn--outline{background:transparent;border-color:var(--button-outline);box-shadow:var(--shadow-xs);color:inherit}
.smc-btn--outline:active{box-shadow:none}
.smc-btn--ghost{background:transparent;border-color:transparent;color:inherit}
.smc-btn--destructive{background:hsl(var(--destructive));color:hsl(var(--destructive-foreground));box-shadow:var(--shadow-xs)}
.smc-btn--link{background:transparent;border-color:transparent;color:hsl(var(--primary));padding-left:0;padding-right:0}
.smc-btn--link::after{display:none}
.smc-btn--link:hover{text-decoration:underline}
`;

/**
 * Primary interactive button. shadcn "new-york" spec as used across the apps:
 * rounded-md, font-medium, hover/active elevate overlay.
 */
function Button({
  variant = "primary",
  size = "default",
  as = "button",
  className = "",
  children,
  ...props
}) {
  useStyle("smc-button", CSS);
  const Comp = as;
  const cls = `smc-btn smc-btn--${size} smc-btn--${variant} ${className}`.trim();
  return /*#__PURE__*/React.createElement(Comp, _extends({
    className: cls
  }, props), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-card{background:hsl(var(--card));color:hsl(var(--card-foreground));
  border:1px solid hsl(var(--card-border));border-radius:var(--radius-2xl);
  box-shadow:var(--shadow-sm);font-family:var(--font-sans)}
.smc-card--flat{box-shadow:none}
.smc-card--interactive{transition:transform .2s,box-shadow .2s,border-color .2s}
.smc-card--interactive:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);border-color:hsl(var(--primary)/.4)}
.smc-card-header{display:flex;flex-direction:column;gap:.375rem;padding:1.5rem}
.smc-card-title{font-weight:var(--weight-semibold);font-size:var(--text-lg);letter-spacing:var(--tracking-tight);line-height:1.2}
.smc-card-desc{font-size:var(--text-sm);color:hsl(var(--muted-foreground));line-height:1.5}
.smc-card-content{padding:0 1.5rem 1.5rem}
.smc-card-footer{display:flex;align-items:center;gap:.75rem;padding:0 1.5rem 1.5rem}
`;
/** Card container. `interactive` adds the lift-on-hover used in product grids. */
function Card({
  interactive = false,
  flat = false,
  className = "",
  children,
  ...props
}) {
  useStyle("smc-card", CSS);
  const cls = `smc-card ${interactive ? "smc-card--interactive" : ""} ${flat ? "smc-card--flat" : ""} ${className}`.replace(/\s+/g, " ").trim();
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, props), children);
}
function CardHeader({
  className = "",
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `smc-card-header ${className}`.trim()
  }, p));
}
function CardTitle({
  className = "",
  as: As = "h3",
  ...p
}) {
  return /*#__PURE__*/React.createElement(As, _extends({
    className: `smc-card-title ${className}`.trim()
  }, p));
}
function CardDescription({
  className = "",
  ...p
}) {
  return /*#__PURE__*/React.createElement("p", _extends({
    className: `smc-card-desc ${className}`.trim()
  }, p));
}
function CardContent({
  className = "",
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `smc-card-content ${className}`.trim()
  }, p));
}
function CardFooter({
  className = "",
  ...p
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `smc-card-footer ${className}`.trim()
  }, p));
}
Object.assign(__ds_scope, { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-field{display:flex;flex-direction:column;gap:.375rem;font-family:var(--font-sans)}
.smc-label{font-size:var(--text-sm);font-weight:var(--weight-medium);color:hsl(var(--foreground));line-height:1}
.smc-input{display:flex;height:2.25rem;width:100%;border-radius:var(--radius-md);
  border:1px solid hsl(var(--input));background:transparent;padding:.25rem .75rem;
  font-size:var(--text-sm);color:hsl(var(--foreground));box-shadow:var(--shadow-xs);
  transition:border-color .15s,box-shadow .15s;font-family:inherit}
.smc-input::placeholder{color:hsl(var(--muted-foreground))}
.smc-input:focus-visible{outline:none;border-color:hsl(var(--ring));box-shadow:0 0 0 1px hsl(var(--ring))}
.smc-input:disabled{cursor:not-allowed;opacity:.5}
.smc-input--err{border-color:hsl(var(--destructive))}
.smc-hint{font-size:var(--text-xs);color:hsl(var(--muted-foreground))}
.smc-hint--err{color:hsl(var(--destructive))}
`;
/** Text input. Pass `label`, `hint`, and `error` for a full form field, or use bare. */
function Input({
  label,
  hint,
  error,
  id,
  className = "",
  ...props
}) {
  useStyle("smc-input", CSS);
  const fid = id || (label ? `smc-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const input = /*#__PURE__*/React.createElement("input", _extends({
    id: fid,
    className: `smc-input ${error ? "smc-input--err" : ""} ${className}`.trim()
  }, props));
  if (!label && !hint && !error) return input;
  return /*#__PURE__*/React.createElement("div", {
    className: "smc-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "smc-label",
    htmlFor: fid
  }, label), input, (error || hint) && /*#__PURE__*/React.createElement("span", {
    className: `smc-hint ${error ? "smc-hint--err" : ""}`.trim()
  }, error || hint));
}
function Label({
  className = "",
  ...p
}) {
  useStyle("smc-input", CSS);
  return /*#__PURE__*/React.createElement("label", _extends({
    className: `smc-label ${className}`.trim()
  }, p));
}
Object.assign(__ds_scope, { Input, Label });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Input.jsx", error: String((e && e.message) || e) }); }

// components/marketing/EngineCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-engine{display:flex;flex-direction:column;padding:1.5rem;
  background:hsl(var(--card));border:1px solid hsl(var(--card-border));
  border-radius:var(--radius-2xl);font-family:var(--font-sans);transition:border-color .2s}
.smc-engine:hover{border-color:hsl(var(--primary)/.35)}
.smc-engine-ic{width:2.5rem;height:2.5rem;border-radius:var(--radius-xl);margin-bottom:1rem;
  display:flex;align-items:center;justify-content:center;
  background:hsl(var(--primary)/.1);border:1px solid hsl(var(--primary)/.2);color:hsl(var(--primary))}
.smc-engine-ic svg{width:1.25rem;height:1.25rem}
.smc-engine-eyebrow{font-size:10px;text-transform:uppercase;font-weight:var(--weight-bold);
  letter-spacing:var(--tracking-wider);color:hsl(var(--primary));margin-bottom:.35rem}
.smc-engine-title{font-size:var(--text-lg);font-weight:var(--weight-bold);color:hsl(var(--foreground));margin:0 0 .5rem}
.smc-engine-desc{font-size:var(--text-sm);line-height:1.55;color:hsl(var(--muted-foreground));margin:0}
`;
/**
 * EngineCard — the icon + eyebrow + title + description card used for the
 * "signal engine" / feature grid.
 */
function EngineCard({
  icon,
  eyebrow,
  title,
  description,
  className = "",
  ...props
}) {
  useStyle("smc-engine", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `smc-engine ${className}`.trim()
  }, props), icon && /*#__PURE__*/React.createElement("span", {
    className: "smc-engine-ic"
  }, icon), eyebrow && /*#__PURE__*/React.createElement("span", {
    className: "smc-engine-eyebrow"
  }, eyebrow), title && /*#__PURE__*/React.createElement("h3", {
    className: "smc-engine-title"
  }, title), description && /*#__PURE__*/React.createElement("p", {
    className: "smc-engine-desc"
  }, description));
}
Object.assign(__ds_scope, { EngineCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/EngineCard.jsx", error: String((e && e.message) || e) }); }

// components/marketing/Eyebrow.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-eyebrow{display:inline-flex;align-items:center;gap:.5rem;font-family:var(--font-sans);
  font-size:var(--text-xs);font-weight:var(--weight-semibold);text-transform:uppercase;
  letter-spacing:var(--tracking-wider);line-height:1}
.smc-eyebrow svg{width:.9rem;height:.9rem}
.smc-eyebrow--pill{padding:.4rem .875rem;border-radius:var(--radius-full);
  background:hsl(var(--primary)/.1);border:1px solid hsl(var(--primary)/.2);color:hsl(var(--primary))}
.smc-eyebrow--plain{color:hsl(var(--primary))}
`;
/**
 * Section eyebrow — the small uppercase label above headlines. `pill` renders
 * the tinted capsule (e.g. "Built by NASA's M365 Copilot Architect").
 */
function Eyebrow({
  pill = true,
  icon,
  className = "",
  children,
  ...props
}) {
  useStyle("smc-eyebrow", CSS);
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `smc-eyebrow smc-eyebrow--${pill ? "pill" : "plain"} ${className}`.trim()
  }, props), icon, children);
}
Object.assign(__ds_scope, { Eyebrow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/Eyebrow.jsx", error: String((e && e.message) || e) }); }

// components/marketing/Logo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-logo{display:inline-flex;align-items:center;gap:.75rem;font-family:var(--font-sans);text-decoration:none}
.smc-logo-mark{border-radius:.75rem;background:linear-gradient(135deg,var(--brand-blue),var(--brand-teal));
  display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;letter-spacing:-1px;
  box-shadow:0 4px 12px -4px rgba(0,120,212,.5);flex-shrink:0}
.smc-logo-txt{display:flex;flex-direction:column;line-height:1.05}
.smc-logo-name{font-weight:700;letter-spacing:-.01em}
.smc-logo-tag{font-size:10px;text-transform:uppercase;font-weight:600;letter-spacing:.12em;color:hsl(var(--muted-foreground))}
`;
const SIZES = {
  sm: {
    tile: 32,
    radius: 9,
    mark: 14,
    name: 15
  },
  md: {
    tile: 40,
    radius: 12,
    mark: 17,
    name: 18
  },
  lg: {
    tile: 56,
    radius: 16,
    mark: 24,
    name: 26
  }
};
/**
 * Brand lockup — the gradient "SM" mark plus wordmark. `onDark` switches the
 * wordmark to white for navy/slate surfaces.
 */
function Logo({
  size = "md",
  showText = true,
  tagline = "M365 Governance",
  onDark = false,
  className = "",
  ...props
}) {
  useStyle("smc-logo", CSS);
  const s = SIZES[size] || SIZES.md;
  return /*#__PURE__*/React.createElement("span", _extends({
    className: `smc-logo ${className}`.trim()
  }, props), /*#__PURE__*/React.createElement("span", {
    className: "smc-logo-mark",
    style: {
      width: s.tile,
      height: s.tile,
      borderRadius: s.radius,
      fontSize: s.mark
    }
  }, "SM"), showText && /*#__PURE__*/React.createElement("span", {
    className: "smc-logo-txt"
  }, /*#__PURE__*/React.createElement("span", {
    className: "smc-logo-name",
    style: {
      fontSize: s.name,
      color: onDark ? "#fff" : "hsl(var(--foreground))"
    }
  }, "Shane McCaw"), tagline && /*#__PURE__*/React.createElement("span", {
    className: "smc-logo-tag",
    style: onDark ? {
      color: "rgba(255,255,255,.6)"
    } : undefined
  }, tagline)));
}
Object.assign(__ds_scope, { Logo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/Logo.jsx", error: String((e && e.message) || e) }); }

// components/marketing/ServiceCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-svc{display:flex;flex-direction:column;padding:1.5rem;
  background:hsl(var(--card));border:1px solid hsl(var(--card-border));
  border-radius:var(--radius-2xl);font-family:var(--font-sans);transition:border-color .2s,transform .2s}
.smc-svc:hover{border-color:hsl(var(--primary)/.4);transform:translateY(-2px)}
.smc-svc-top{display:flex;justify-content:space-between;align-items:flex-start;gap:.5rem;margin-bottom:1rem}
.smc-svc-dur{display:inline-flex;align-items:center;gap:.3rem;font-size:var(--text-xs);color:hsl(var(--muted-foreground))}
.smc-svc-dur svg{width:.85rem;height:.85rem}
.smc-svc-title{font-size:var(--text-xl);font-weight:var(--weight-bold);color:hsl(var(--foreground));margin:0 0 .5rem}
.smc-svc-desc{font-size:var(--text-sm);line-height:1.55;color:hsl(var(--muted-foreground));margin:0 0 1.5rem;flex-grow:1}
.smc-svc-foot{display:flex;align-items:center;justify-content:space-between;
  padding-top:1rem;border-top:1px solid hsl(var(--card-border));margin-top:auto}
.smc-svc-price{font-size:var(--text-2xl);font-weight:var(--weight-extrabold);color:hsl(var(--foreground))}
.smc-svc-price small{font-size:var(--text-xs);font-weight:var(--weight-regular);color:hsl(var(--muted-foreground));margin-left:.25rem}
`;
/**
 * ServiceCard — priced offering card (category tag, optional duration, title,
 * description, price + CTA). Mirrors the assessment/retainer catalog cards.
 */
function ServiceCard({
  category = "Enterprise",
  categoryTone = "blue",
  duration,
  durationIcon,
  title,
  description,
  price,
  priceNote = "one-time",
  ctaLabel = "Purchase",
  ctaIcon,
  onCta,
  className = "",
  ...props
}) {
  useStyle("smc-svc", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `smc-svc ${className}`.trim()
  }, props), /*#__PURE__*/React.createElement("div", {
    className: "smc-svc-top"
  }, /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    variant: "soft",
    tone: categoryTone
  }, category), duration && /*#__PURE__*/React.createElement("span", {
    className: "smc-svc-dur"
  }, durationIcon, duration)), title && /*#__PURE__*/React.createElement("h3", {
    className: "smc-svc-title"
  }, title), description && /*#__PURE__*/React.createElement("p", {
    className: "smc-svc-desc"
  }, description), /*#__PURE__*/React.createElement("div", {
    className: "smc-svc-foot"
  }, /*#__PURE__*/React.createElement("span", {
    className: "smc-svc-price"
  }, price, price && priceNote && /*#__PURE__*/React.createElement("small", null, "/ ", priceNote)), /*#__PURE__*/React.createElement(__ds_scope.Button, {
    size: "sm",
    onClick: onCta
  }, ctaLabel, ctaIcon)));
}
Object.assign(__ds_scope, { ServiceCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/ServiceCard.jsx", error: String((e && e.message) || e) }); }

// components/marketing/StatCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function useStyle(id, css) {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const el = document.createElement("style");
  el.id = id;
  el.textContent = css;
  document.head.appendChild(el);
}
const CSS = `
.smc-stat{display:flex;align-items:center;gap:1rem;padding:1.25rem;
  background:hsl(var(--card));border:1px solid hsl(var(--card-border));
  border-radius:var(--radius-2xl);font-family:var(--font-sans)}
.smc-stat-ic{width:2.75rem;height:2.75rem;border-radius:var(--radius-xl);flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  background:hsl(var(--primary)/.1);border:1px solid hsl(var(--primary)/.2);color:hsl(var(--primary))}
.smc-stat-ic svg{width:1.25rem;height:1.25rem}
.smc-stat-val{font-size:var(--text-xl);font-weight:var(--weight-extrabold);line-height:1.1;color:hsl(var(--foreground))}
.smc-stat-lbl{font-size:var(--text-xs);color:hsl(var(--muted-foreground));margin-top:.15rem}
`;
/** Compact metric tile: icon + big value + label. Used in the credibility strip. */
function StatCard({
  icon,
  value,
  label,
  className = "",
  ...props
}) {
  useStyle("smc-stat", CSS);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: `smc-stat ${className}`.trim()
  }, props), icon && /*#__PURE__*/React.createElement("span", {
    className: "smc-stat-ic"
  }, icon), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "smc-stat-val"
  }, value), /*#__PURE__*/React.createElement("div", {
    className: "smc-stat-lbl"
  }, label)));
}
Object.assign(__ds_scope, { StatCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/marketing/StatCard.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Alert = __ds_scope.Alert;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.CardHeader = __ds_scope.CardHeader;

__ds_ns.CardTitle = __ds_scope.CardTitle;

__ds_ns.CardDescription = __ds_scope.CardDescription;

__ds_ns.CardContent = __ds_scope.CardContent;

__ds_ns.CardFooter = __ds_scope.CardFooter;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Label = __ds_scope.Label;

__ds_ns.EngineCard = __ds_scope.EngineCard;

__ds_ns.Eyebrow = __ds_scope.Eyebrow;

__ds_ns.Logo = __ds_scope.Logo;

__ds_ns.ServiceCard = __ds_scope.ServiceCard;

__ds_ns.StatCard = __ds_scope.StatCard;

})();
