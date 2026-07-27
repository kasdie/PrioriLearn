# Design System - PrioriLearn AI

## Product Context

- **What this is:** A private, evidence-led planning workspace that turns confirmed course and calendar data into a reviewable study plan.
- **Who it is for:** University students who need a clear next action, honest consequences, and control over any generated plan.
- **Space:** Education productivity, personal planning, and decision support.
- **Project type:** Desktop web application. The private alpha supports fine-pointer viewports at `1024x768` and larger; touch-first mobile UI is deferred.
- **Memorable posture:** PrioriLearn makes the cost of delay visible without judging the student, then places a credible recovery action beside it.

## Aesthetic Direction

- **Direction:** Industrial/utilitarian with a restrained editorial accent.
- **Decoration:** Minimal. Hierarchy comes from typography, spacing, borders, and semantic color rather than illustration or ornamental cards.
- **Mood:** Calm, compact, private, and evidence-led. Consequences should feel concrete and serious, while recovery remains visibly achievable.
- **Layout:** Grid-disciplined. The workspace favors scanning, comparison, and repeated action over marketing composition.
- **Safe choices:** Familiar labeled navigation, predictable forms, clear status language, and dense but readable data rows.
- **Deliberate risks:** Use serif type only for the selected task and consequence statements; give measured loss a strong visual hierarchy while always pairing it with assumptions and a recovery action.

## Typography

### Families

- **Body, UI, forms, tables:** `Source Sans 3`, with `"Noto Sans"`, `"Segoe UI"`, and `sans-serif` fallbacks. It supports compact interfaces and Vietnamese text without becoming clinical.
- **Selected task and consequence:** `Source Serif 4`, with `"Noto Serif"`, `Georgia`, and `serif` fallbacks. Use it sparingly for the selected task title, Cost of Delay statement, and high-value recovered/lost outcomes.
- **Data:** `Source Sans 3` with `font-variant-numeric: tabular-nums` for schedules, versions, scores, durations, and timers.
- **Code and identifiers:** `"IBM Plex Mono"`, `Consolas`, and `monospace`.
- **Loading strategy:** T13 will self-host WOFF2 files. Until then, the current local/system fallback remains valid; do not add a blocking remote font request.

### Weights And Scale

| Token | Size / line-height | Weight | Usage |
| --- | --- | --- | --- |
| `display` | 32px / 38px | 650 serif | Selected task or consequence only |
| `h1` | 28px / 34px | 700 | Page title |
| `h2` | 20px / 27px | 700 | Major workspace section |
| `h3` | 17px / 24px | 700 | Tool or panel title |
| `body` | 16px / 24px | 400 | Default copy and actions |
| `body-strong` | 16px / 24px | 650 | Key values and row titles |
| `metadata` | 14px / 20px | 500 | Essential evidence and status metadata |
| `label` | 14px / 18px | 700 | Form labels and compact controls |

Do not scale type with viewport width. Letter spacing is `0`; uppercase labels may use at most `0.06em`. Do not put essential information below `14px`.

## Color

### Core Tokens

| Role | Token | Value | Usage |
| --- | --- | --- | --- |
| Canvas | `--color-canvas` | `#F6F8F6` | App background |
| Surface | `--color-surface` | `#FFFFFF` | Controls and independently framed tools |
| Surface muted | `--color-surface-muted` | `#EEF3EF` | Secondary context and hover rows |
| Text | `--color-text` | `#17231F` | Primary text |
| Text muted | `--color-text-muted` | `#5E6B64` | Secondary copy; never the only status cue |
| Border | `--color-border` | `#CBD8D0` | Controls and structural separators |
| Border subtle | `--color-border-subtle` | `#E3E9E5` | Row dividers |
| Action | `--color-action` | `#176B52` | Primary command and selected navigation |
| Action hover | `--color-action-hover` | `#10523E` | Hover and pressed command |
| Action soft | `--color-action-soft` | `#E4F1E9` | Selected rows and verified summaries |
| Verified | `--color-verified` | `#267553` | Confirmed server state |
| Uncertainty | `--color-uncertain` | `#7565A8` | Review-needed and model uncertainty |
| Warning | `--color-warning` | `#A56C10` | Measured consequence and conflict |
| Warning surface | `--color-warning-soft` | `#FFF3D6` | Cost of Delay and recoverable warning |
| Destructive | `--color-danger` | `#B64E43` | Deletion and irreversible commands |
| Destructive surface | `--color-danger-soft` | `#FAECE9` | Destructive warning background |
| Information | `--color-info` | `#2E6687` | Neutral system guidance |
| Focus | `--color-focus` | `#1D6FE8` | Keyboard focus indicator only |

The palette is restrained, not monochromatic: green represents deliberate action and verified data; gold represents consequence; coral is reserved for destructive state; violet indicates uncertainty. Never use warning or danger colors as decoration. Never communicate confidence or status through color alone.

### Contrast And Dark Surfaces

- Text and controls meet WCAG 2.2 AA: `4.5:1` for body text and `3:1` for large text, controls, focus indicators, and meaningful graphics.
- Focus mode may use a dark forest surface (`#142D22`) with white (`#FFFFFF`) and muted light text (`#DDEAE2`). It is a functional workspace state, not a global dark theme.
- A future dark mode must redesign surface relationships and reduce semantic saturation; do not mechanically invert these tokens.

## Spacing

- **Base unit:** `4px`.
- **Density:** Comfortable for primary actions, compact for evidence and schedule rows.
- **Scale:** `2xs: 2px`, `xs: 4px`, `sm: 8px`, `md: 12px`, `lg: 16px`, `xl: 24px`, `2xl: 32px`, `3xl: 48px`, `4xl: 64px`.
- Keep related label/value pairs within `4-8px`; separate actions from explanatory copy by at least `12px`; separate major sections by `32-48px`.

## Layout

- **Approach:** Grid-disciplined desktop workspace.
- **Sidebar:** `232px`, labeled, fixed within the app shell. Current page uses both visual selection and `aria-current="page"`.
- **Workspace:** Flexible primary column plus an optional `274px` context rail. The context rail collapses before required status or actions.
- **Content width:** Main reading/action regions should stay below `1120px`; dense timeline and extraction tools may use the available workspace width.
- **Supported viewport:** `1024x768` and larger. Validate `1024x768`, `1280x720`, `1440x900`, and `1920x1080` at `100%` and `200%` zoom.
- **Reflow:** At browser zoom or a narrow fine-pointer viewport, required content becomes one column. Do not remove status, evidence, or commands.
- **Grid:** Prefer explicit `minmax(0, 1fr)` tracks and stable dimensions for timelines, controls, scores, and toolbars.

### Shape And Elevation

- Radius scale: `2px` for compact status, `4px` for inputs/rows, `6px` for buttons and tools, `8px` maximum for modal/tool frames. Pills are allowed only for statuses or binary segmented choices.
- Use borders and background shifts before shadows. Standard tools have no shadow; floating menus use `0 8px 24px rgba(23, 35, 31, 0.12)`; modals use `0 24px 64px rgba(13, 30, 22, 0.28)`.
- Page sections remain unframed. Cards are only for independently selectable/movable records, modals, menus, and genuinely framed tools. Never nest cards.

## Motion

- **Approach:** Minimal-functional.
- **Durations:** micro `80ms`, short `160ms`, medium `240ms`; no routine transition exceeds `400ms`.
- **Easing:** enter `cubic-bezier(0.2, 0.8, 0.2, 1)`, exit `ease-in`, move `ease-in-out`.
- Animate opacity, transform, or state color only when it clarifies cause and effect. Never animate layout continuously or use motion as the only state signal.
- Under `prefers-reduced-motion: reduce`, remove nonessential animation and smooth scrolling while preserving immediate state changes.

## Component Vocabulary

Every Slice 1 component must map to one of these primitives before a new visual pattern is introduced.

### Commands

- **Primary button:** One main server mutation per region. Minimum height `44px`; icon plus concise label when the command needs both.
- **Secondary button:** Alternative command, minimum height `40px`, bordered surface.
- **Text button:** Low-priority command inside an existing context; never the only control for a destructive action.
- **Icon button:** Familiar Lucide icon, stable `40x40px`, accessible name, and tooltip when the meaning is not universal.
- **Destructive button:** Danger color, explicit noun/verb, and confirmation for irreversible actions.
- **Segmented control:** Coach mode or mutually exclusive view modes only. Selection is exposed to assistive technology.

### Inputs

- **Field:** Visible persistent label, optional help text, input, and an inline message region. Placeholder text never replaces a label.
- **Select/menu:** Finite option sets. Use checkboxes/toggles for independent binary choices and stepper/input controls for numeric duration or time.
- **Evidence field:** Field value plus source excerpt, confidence category (`High confidence`, `Review`, `Missing`), assumptions, and explicit `Unknown` where nullable.
- **File row:** Stable row that owns `uploading`, `upload_failed`, `uploaded`, `extracting`, `review`, and `confirmed` states and preserves retry/remove actions.

### Status And Feedback

- **Status badge:** Short server-confirmed state. It supplements, never replaces, plain language.
- **Inline alert:** The required pattern for blocked workflows. State what failed, what remains safe, and the next recovery action.
- **Consequence alert:** Warning surface with delay horizon, concrete buffer/workload change, evidence range, assumptions, confidence, and one recovery/replan action.
- **Toast:** Confirmation of a completed nonblocking action only. Never use it as the sole error for import, confirmation, generation, approval, or deletion.
- **Skeleton:** Matches final geometry and uses one quiet progress treatment. It must not imply success.
- **Empty state:** Describes the next real action. First-run Today uses `Add data -> Review -> Build first plan` and makes no plan/score claims.

### Structured Work

- **Timeline block:** Server-owned plan item with start, duration, status, conflict, and keyboard editing actions. Dimensions remain stable while status changes.
- **Evidence row:** A compact, unframed row containing factor, weight, normalized value, source, confidence, and assumptions. Evidence uses a vertical ledger, not equal decorative cards.
- **Plan approval bar:** Shows proposed version, pending conflict state, server mutation progress, and explicit approve command. Approval appears only after the matching server receipt.
- **Modal:** A genuinely focused tool. It has a named dialog, focus trap, Escape behavior when safe, and focus restoration. Destructive submission cannot be dismissed accidentally.
- **Drawer/context rail:** Secondary detail that may collapse without hiding required action or state.

## State Contract

Every asynchronous primitive implements the applicable states below. Server-confirmed data remains visually distinct from current-tab drafts.

- **Loading:** Preserve geometry, disable duplicate mutation, and state the action in progress.
- **Empty:** Offer one credible next action without fabricated scores, plans, or progress.
- **Error:** Keep the user's draft; say what was not saved, what remains safe, and how to retry.
- **Partial:** Keep confirmed panels and last-updated time, mark unavailable inputs, and disable recommendation/focus when ranking inputs are incomplete.
- **Success:** Render only from the server response that confirms the mutation and version.
- **Disabled:** Pair visual treatment with the native/ARIA disabled state and nearby reason.
- **Focus-visible:** Use a `2px` focus ring in `--color-focus` with `2px` offset; never remove it.
- **Selected:** Use state text/icon and a subtle action surface, not color alone.
- **Destructive:** Explain scope and permanence before mutation; render completion only after server confirmation.
- **Version conflict:** Preserve the proposed edit, fetch the current active/pending read model, and require explicit review. Never silently overwrite.
- **Session expired:** Open re-authentication in place and retain unsaved content only in current-tab memory. Never persist raw import or extraction drafts to browser storage.

## Content Rules

- Use utility copy in the order `orientation -> status -> action`.
- Consequence copy names the delay horizon and concrete change first. Estimated goal-score movement is a range below it, with evidence and assumptions.
- Highlight what the student missed and the points/buffer at risk only when confirmed data supports the estimate. Never state a deterministic grade loss.
- Pair every loss-framed warning with one small recovery action and a reviewable replan.
- Never label the student as lazy, failed, or undisciplined. Completion reports value recovered instead of generic praise or celebration effects.

## Accessibility

- Provide a skip link, semantic landmarks/headings, deterministic tab order, and visible current navigation state.
- Standard controls are at least `40px` high; primary/destructive controls are at least `44px`.
- Dialogs announce their title, trap focus, close with Escape when safe, and restore focus.
- Live regions announce meaningful request outcomes but do not announce every timer tick.
- Every icon-only action has an accessible name. Confidence, evidence, conflicts, and state never rely on color alone.
- Desktop alpha does not promise touch-first mobile support, but 200% zoom must keep every required action and status available.

## Decisions Log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-20 | Initial design system created | Consolidates the accepted design review into the implementation source of truth before Slice 1 UI changes. |
| 2026-07-20 | Consequence-aware highlight retained | The user wants missed value and score impact to be salient; evidence, ranges, assumptions, and recovery controls keep it honest. |
| 2026-07-20 | Desktop-only private alpha | Engineering effort stays on the trustworthy core loop; mobile starts after desktop stability. |
| 2026-07-20 | Font self-hosting deferred to T13 | Data correctness and session boundaries should not be coupled to a visual migration. |
