## 1. Product Overview
Stabilize production connectivity for the Seismic DSP Dashboard and make typography/layout consistently responsive across all dashboard views.
This improves reliability (fewer outages/blank states) and usability on varied screen sizes.

## 2. Core Features

### 2.1 User Roles
No role-based authentication is required for this scope.

### 2.2 Feature Module
The dashboard requirements consist of the following main pages:
1. **Home & Navigation**: entry content, in-app navigation between dashboard views, global connectivity status messaging.
2. **Engineer Portal**: upload area, project list, sidebar widgets; responsive layout/typography.
3. **Authority Portal**: approvals and reporting widgets; responsive layout/typography.
4. **Soil & Seismic Analysis**: data panels and charts; responsive layout/typography.
5. **3D Visualization**: 3D viewer canvas and controls; responsive layout/typography.

### 2.3 Page Details
| Page Name | Module Name | Feature description |
|---|---|---|
| Home & Navigation | Production connectivity configuration | Read runtime configuration from environment; route API calls to same-origin `/api/*`; ensure no hardcoded dev-only endpoints. |
| Home & Navigation | Connectivity health checks | Provide lightweight health checks for backend dependencies (database, external APIs where applicable). |
| Home & Navigation | User-visible error handling | Show clear, non-blocking error states when API calls fail (message + retry action) instead of silent failures/blank UI. |
| Home & Navigation | Global responsive typography | Apply consistent typography scale (headings/body/labels) using shared tokens; prevent text overflow and cramped spacing. |
| Home & Navigation | Global responsive layout rules | Standardize spacing and container widths; ensure navigation and content areas reflow at common breakpoints. |
| Engineer Portal | Responsive grid reflow | Reflow main grid to 1 column on small screens and 2–3 columns on wider screens; avoid fixed `grid-cols-3` layouts that break on narrow widths. |
| Engineer Portal | Responsive content density | Keep cards readable: clamp long text, wrap metadata, and maintain minimum touch target sizes for actions. |
| Authority Portal | Responsive grid reflow | Ensure approvals panels, summaries, and tables/cards adapt to available width with predictable stacking. |
| Soil & Seismic Analysis | Responsive chart & panel layout | Ensure charts maintain aspect ratio, labels remain legible, and panels stack gracefully without horizontal scrolling. |
| 3D Visualization | Responsive viewer sizing | Make the viewer fit available viewport height/width; keep tool controls accessible without covering essential content. |

## 3. Core Process
**User flow**
1. You open the dashboard Home.
2. You navigate to a view (Engineer, Authority, Soil Analysis, 3D Visualization).
3. The view requests data via `/api/*` endpoints.
4. If dependencies are unavailable (e.g., database down), the UI shows an error state with a retry option.
5. When connectivity recovers, the view successfully loads and renders data.

```mermaid
graph TD
  A["Home & Navigation"] --> B["Engineer Portal"]
  A --> C["Authority Portal"]
  A --> D["Soil & Seismic Analysis"]
  A --> E["3D Visualization"]
  B --> F["API: /api