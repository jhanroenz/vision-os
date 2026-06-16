/** User-facing UI / frontend / visual work — pages, components, styling, layouts. */
const UI_TASK_PATTERNS = [
  /\b(ui|ux|gui|frontend|front-end|web\s*app|webpage|web\s*page|landing\s*page)\b/i,
  /\b(portfolio|dashboard|homepage|home\s*page|marketing\s*site|brochure\s*site)\b/i,
  /\b(component|widget|modal|dialog|sidebar|navbar|nav\s*bar|header|footer|hero)\b/i,
  /\b(form|button|card|table|layout|grid|flex|responsive|mobile[- ]first)\b/i,
  /\b(css|scss|sass|tailwind|styled|theme|design\s*system|typography|color\s*palette)\b/i,
  /\b(make\s*it\s*(?:look|pretty|beautiful|modern|professional|polished|clean))\b/i,
  /\b(redesign|restyle|rebrand|refine|polish|skin|visual|appearance|aesthetic)\b/i,
  /\b(icon|illustration|banner|carousel|gallery|menu|dropdown|tooltip|toast)\b/i,
];

export function isUiTask(message) {
  return UI_TASK_PATTERNS.some((p) => p.test(String(message ?? "")));
}

/** Extra web_search focus for UI-heavy tasks. */
export function buildUiResearchQuery(message, { stackLabel = "web", year } = {}) {
  const y = year ?? new Date().getFullYear();
  const task = String(message ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return `${stackLabel} modern UI CSS design system layout responsive typography ${task} ${y}`;
}

/** Suggested plan steps appended to execute brief on UI tasks. */
export function uiTaskPlanHints() {
  return [
    "Define design tokens (CSS variables: colors, spacing, type scale) in one global file",
    "Build page shell: max-width container, header/nav, main, footer",
    "Implement sections/components with consistent spacing — mobile-first",
    "Polish: hover/focus states, contrast, empty states; verify_project or run_check (npm run build)",
  ];
}

export const UI_DESIGN_GUIDANCE_BLOCK = `UI & frontend quality (mandatory on ANY visual / layout / styling task):
You are a senior product engineer — ship polished, cohesive interfaces, not bare HTML defaults.

Workflow (follow in order — do NOT skip to random components):
1. TOKENS FIRST — one file (e.g. src/styles/tokens.css or src/index.css) with CSS variables BEFORE writing components:
   :root {
     --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
     --font-mono: ui-monospace, "Cascadia Code", monospace;
     --text-xs: 0.75rem; --text-sm: 0.875rem; --text-base: 1rem;
     --text-lg: 1.125rem; --text-xl: 1.25rem; --text-2xl: 1.5rem; --text-3xl: 1.875rem;
     --leading-tight: 1.25; --leading-normal: 1.5; --leading-relaxed: 1.625;
     --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem; --space-4: 1rem;
     --space-6: 1.5rem; --space-8: 2rem; --space-12: 3rem; --space-16: 4rem;
     --radius-sm: 0.375rem; --radius-md: 0.5rem; --radius-lg: 0.75rem;
     --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.06);
     --shadow-md: 0 4px 12px rgb(0 0 0 / 0.08);
     --color-bg: #fafafa; --color-surface: #ffffff; --color-border: #e5e7eb;
     --color-text: #111827; --color-text-muted: #6b7280;
     --color-accent: #2563eb; --color-accent-hover: #1d4ed8;
     --color-success: #059669; --color-danger: #dc2626;
     --container-max: 72rem; --header-height: 4rem;
   }
   @media (prefers-color-scheme: dark) { /* override tokens OR use a .dark class */ }
2. RESET + BASE — box-sizing border-box; body margin 0; font-family var(--font-sans); color var(--color-text); background var(--color-bg); line-height var(--leading-normal); -webkit-font-smoothing antialiased;
3. LAYOUT SHELL — centered container (max-width var(--container-max); margin-inline auto; padding-inline var(--space-4)); semantic HTML (header, main, section, footer); use flex/grid — never rely on bare block stacking alone.
4. COMPONENTS — reuse tokens only (no one-off hex colors); consistent padding (var(--space-4)–var(--space-8)); border-radius var(--radius-md); buttons: min-height 2.5rem, padding-inline var(--space-4), cursor pointer, :hover and :focus-visible outlines.
5. RESPONSIVE — mobile-first; @media (min-width: 640px) and (min-width: 1024px) breakpoints; no horizontal scroll on 320px viewport; tap targets ≥ 44px on touch.
6. POLISH PASS — before handoff: spacing rhythm even, headings hierarchical (one h1), links/buttons have hover+focus, images have alt text, empty sections removed.

Hard rules (weak-model anti-patterns — NEVER do these):
- NEVER ship unstyled browser-default HTML (Times New Roman, blue underlined links, zero padding).
- NEVER mix random colors/fonts per section — one design system per project.
- NEVER use inline style="" on more than a one-off debug — use classes + CSS variables.
- NEVER use placeholder gray boxes without labels when real content is known.
- NEVER skip :hover, :focus-visible, and disabled states on interactive elements.
- NEVER use font-size below 14px for body text or pure #000/#fff without muted secondary text.
- NEVER center every element — use alignment intentionally (left-align prose, center hero only if appropriate).

Stack choices (pick ONE approach per project and stay consistent):
- Plain CSS / Vue SFC style: tokens in src/index.css or src/assets/main.css, BEM-like class names (.card, .btn, .section).
- Tailwind: configure theme in tailwind.config, use @layer components for repeated patterns, not 200-char class strings on every element.
- Component library (if already in project): use its tokens/theme API — do not fight the library with custom overrides everywhere.

UI task plan template (use in update_task_plan when building/redesigning interfaces):
  research → tokens/global CSS → layout shell → core components → content sections → responsive pass → verify build → visual polish

web_search on UI tasks should cover: design tokens, layout pattern, and stack-specific styling approach for ${new Date().getFullYear()} (optional but recommended when training data may be stale).

Final handoff for UI work: tell Master Jan what changed visually and why it meets his request; mention he can run npm run dev locally to view it, plus 2–3 concrete design choices (type scale, color accent, layout pattern) — no tool names or STATUS lines.`;
