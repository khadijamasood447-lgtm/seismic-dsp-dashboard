# Page Design Spec — Non-WASM IFC Viewer + Chat + Soil (1–2m)

## Global Styles (All Pages)
- Design approach: desktop-first, then scale down to tablet/mobile.
- Layout system: CSS Grid for major page regions + Flexbox within panels.
- Base background: `#0B1220` (dark navy)
- Surface background: `#0F1A2E`
- Card background: `#121F36`
- Primary accent: `#4F8CFF`
- Secondary accent: `#2AD4B7`
- Text primary: `#E6EDF7`
- Text secondary: `#A9B4C7`
- Border color: `rgba(255,255,255,0.08)`
- Font: system UI stack; code/ids: monospace
- Typography scale (desktop): 12 / 14 / 16 / 20 / 24
- Buttons:
  - Primary: filled accent, hover brighten 6%, active darken 6%, disabled 40% opacity
  - Secondary: outlined, hover background `rgba(79,140,255,0.12)`
- Links: accent color, underline on hover only
- Focus states: 2px outline in primary accent for accessibility

---

## Page 1 — Workspace (Model + Chat + Soil)

### Meta Information
- Title: “Workspace — IFC Viewer”
- Description: “Open an IFC model, inspect elements, ask chat queries, and review soil outputs (1–2m).”
- Open Graph:
  - `og:title`: “IFC Workspace”
  - `og:description`: “Non-WASM IFC viewing with chat-assisted queries.”

### Layout
- Primary layout: 3-column CSS Grid + top status bar.
- Grid (desktop):
  - Rows: `[topbar 48px] [content 1fr]`
  - Columns: `[left 320px] [center 1fr] [right 420px]`
- Spacing: 12px outer padding; 12px gutters; 8px internal component spacing.
- Responsive behavior:
  - Tablet: collapse left panel into a slide-out drawer; right panel becomes a tabbed panel.
  - Mobile: center viewport first; left/right panels become full-screen sheets.

### Page Structure
1. Top Status Bar
2. Left Panel (Model)
3. Center Panel (3D Viewport)
4. Right Panel (Tabs: Chat / Soil)

### Sections & Components

#### 1) Top Status Bar (fixed height)
- Left:
  - App name + current file name (ellipsis truncation)
- Middle:
  - Loading/progress indicator states:
    - Idle: “No model loaded”
    - Loading: progress bar + “Parsing… 42%”
    - Ready: “Loaded • Parse 3.2s • Entities 120k”
    - Warning: show count badge (click opens diagnostics modal)
- Right:
  - Buttons: “Open IFC”, “Fit View”, “Reset”, “Help”

#### 2) Left Panel — Model Browser
- Header: “Model” with search input
- Content sections:
  - Structure tree:
    - Two toggle modes: “By Storey/Spatial” and “By Type”
    - Each node shows name + count
  - Selection summary card (visible when something is selected):
    - IFC Type, Name, GlobalId (copy button)
    - Actions: “Focus”, “Clear”
- Interaction:
  - Selecting a tree node highlights the element(s) in the 3D viewport.
  - Search results show as list; selecting result sets selection.

#### 3) Center Panel — 3D Viewport
- Canvas area (Three.js): full height/width of center column.
- Overlay controls (top-right in canvas):
  - Orbit toggle (default on)
  - Section toggle (on/off)
  - Screenshot export
- Viewport interactions:
  - Click to select element; selected element gets outline + subtle glow.
  - Hover: show tooltip with element name/type (throttled).
- Loading/empty state:
  - Empty: centered card “Open an IFC to begin” + “Open IFC” button.
  - Loading: large progress + short status text (e.g., “Building geometry buffers”).

#### 4) Right Panel — Tabs
Tabs are fixed at top: **Chat**, **Soil (1–2m)**.

##### 4A) Chat Tab (kept behavior)
- Chat transcript area:
  - Streaming response rendering
  - Message grouping by user/assistant
  - “Scroll to latest” affordance
- Composer:
  - Multiline input
  - “Send” primary button
  - “Attach selection” chip (shows selected GlobalId/type; removable)
- Context preview (collapsed by default):
  - Shows small JSON-like snippet of selection context that will be sent

##### 4B) Soil Tab — Depth-limited UI
- Non-negotiable rule: only display data between **1.0m and 2.0m** depth.
- Header:
  - Title: “Soil (Depth 1–2m)”
  - Inline badge: “Fixed range”
- Components:
  - Depth range display (read-only):
    - Two disabled inputs: Min=1.0m, Max=2.0m (or a single read-only pill)
  - Soil chart card:
    - Y-axis labeled Depth (m) with ticks only from 1 to 2
    - Any series values outside 1–2 are filtered out before rendering
  - Soil 3D/profile card (if present):
    - Clip/limit geometry or samples to 1–2m
- Empty state:
  - If no soil data exists in 1–2m range: show “No soil data available for 1–2m”.

#### 5) Diagnostics Modal (invoked from status bar)
- Tabs: “Errors”, “Performance”, “Capabilities”
- Errors: list with timestamps, copy button
- Performance: parse time, entity count, memory estimate
- Capabilities: supported IFC constructs and fallbacks

---

## Page 2 — Help & Diagnostics

### Meta Information
- Title: “Help & Diagnostics”
- Description: “Viewer capabilities, known limitations, and a diagnostics export.”

### Layout
- Single-column centered container, max-width 960px.
- Content organized into cards with clear headings.

### Sections & Components
1. “How to use the Viewer” card
2. “Non-WASM Parser Capabilities” card
3. “Known Limitations / Fallbacks” card
4. “Export Diagnostics Bundle” card
   - Button: “Export”
   - Includes: parser version, browser info, recent errors, basic model stats