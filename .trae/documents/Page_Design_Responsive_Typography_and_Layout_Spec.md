# Page Design: Responsive Typography & Layout

## Global Styles (applies to all pages)
- Layout system: Tailwind utility-first with Flexbox + CSS Grid; use breakpoint-driven variants (`sm/md/lg/xl`) and container-based max widths.
- Design tokens (desktop-first):
  - Container: `max-w-7xl mx-auto px-6` (reduce to `px-4` on small screens).
  - Spacing scale: base gap `gap-6` desktop, `gap-4` small.
  - Typography scale: define consistent classes for `h1/h2/h3/body/label` (avoid ad-hoc sizes per component).
  - Line-length: keep body text within ~60–80 characters per line using max-width on prose blocks.
  - Buttons/inputs: minimum height 40px; clear hover/focus states; prevent text truncation on narrow widths.
- Responsive rules:
  - Never require horizontal scrolling for primary content.
  - Cards/tables must wrap or collapse columns; prefer stacking over squeezing.
  - Charts/maps/3D canvases must be fluid width with controlled height via viewport units and max/min bounds.
- Meta defaults:
  - Title template: `Seismic DSP Dashboard — {View}`
  - Description: concise view purpose; Open Graph uses same title/description.

---

## 1) Home & Navigation
- Layout: Stacked sections; centered container; navigation appears for non-home views.
- Page structure:
  1. Top area: brand + primary CTA navigation (desktop horizontal; small screens collapses to menu).
  2. Connectivity banner/toast area: reserved space for transient errors (doesn’t shift layout aggressively).
  3. Main content: hero/overview cards that link to views.
- Components:
  - Navigation bar: sticky on scroll for non-home; wraps items and provides overflow handling.
  - Global error/toast: shows API failure summary + “Retry” action.

## 2) Engineer Portal
- Layout: Desktop 2-column (main + sidebar) within a 12-col grid; collapses to single column on small screens.
- Page structure:
  1. Header: title + subtitle; `h1` scales down on small.
  2. Main column: Upload card; Project submissions list.
  3. Sidebar: Stats, Guidelines, Activity.
- Responsiveness requirements:
  - Replace fixed 3-col grid with breakpoint grid (e.g., 1 col small, 3 cols desktop).
  - Cards: consistent padding; metadata rows wrap; buttons flow to next line if needed.

## 3) Authority Portal
- Layout: Dashboard grid with primary panel + secondary panels; responsive stacking.
- Sections:
  - Approvals panel: list/table that collapses columns into stacked rows on narrow widths.
  - Reports/widgets: card grid (2–3 across desktop, 1 across small).
  - Connectivity states: inline skeletons and retry UI when data fails.

## 4) Soil & Seismic Analysis
- Layout: Split-pane on desktop (controls/filters + results), stacked on smaller screens.
- Sections:
  - Control panel: form controls with consistent label sizing and spacing.
  - Results: charts and data summaries in cards.
- Chart responsiveness:
  - Charts scale to container width; x-axis labels rotate/truncate responsibly; tooltips remain readable.

## 5) 3D Visualization
- Layout: Viewer-first with side/top control rail.
- Sections:
  - Viewer canvas: fluid width; height uses `calc(100vh - header)` with min/max bounds.
  - Controls: docked panel on desktop; becomes collapsible drawer/sheet on small screens.
- Interaction states:
  - Loading state overlay on viewer.
  - Error state overlay: brief message + retry; doesn’t remove navigation.