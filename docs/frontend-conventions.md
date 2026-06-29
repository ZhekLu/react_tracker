# Frontend Conventions

## Component Boundaries

- `app/` owns top-level composition and workspace state.
- `features/` owns domain screens such as Roadmap, Resources, and Exams.
- `components/ui/` contains small reusable controls with no tracker-domain logic.
- `components/rewards/` contains completion feedback components.
- `hooks/` contains reusable behavior such as timed reward effects.
- `types/` contains shared domain contracts.

Feature components may compose UI primitives, but UI primitives must not import
feature modules.

## State

- Keep transient visual state local to the component that renders it.
- Keep course/task/resource/exam state at the app workspace boundary. Fetch one
  complete course workspace from the API and refresh it after mutations until a
  finer cache is justified.
- Derive progress and counts from domain state instead of storing duplicate UI
  counters.
- Do not mutate API objects in-place.
- Backend mutations are revision-aware. Send the entity revision returned by the
  workspace endpoint and surface `409` conflicts instead of hiding them.

## Editors

- Tiptap/ProseMirror is the rich editing foundation.
- Mount editors only when their panel is open.
- Store editor content through explicit `onChange` callbacks.
- Keep toolbar commands declarative and use icon buttons with accessible labels.
- Highlight colors are visible swatches, not text-only commands.

## Styling

- Global design tokens live at the top of `styles/global.css`.
- Components use stable dimensions and responsive grid constraints.
- Cards use a maximum 8px radius.
- Operational screens favor dense rows and clear grouping over decorative card
  galleries.
- Course accents may tint controls, but state colors remain consistent:
  green for done, amber for questions, blue for later, neutral gray for todo.
- Avoid viewport-based font scaling and negative letter spacing.

## Motion

- Motion must explain state changes, not decorate idle screens.
- Task/resource/exam completion uses a small local particle burst.
- Closing a day uses a larger burst plus a short header/background confirmation.
- Effects clean themselves up after animation.
- `prefers-reduced-motion` disables animations and transitions.

## Accessibility

- Icon-only controls require `aria-label` and `title`.
- Progress components expose progressbar semantics.
- Status must be communicated by text/icon as well as color.
- Keyboard focus must remain visible.
- Interactive elements use native buttons, inputs, links, and details elements.

## Verification

Before committing a frontend slice:

```sh
make react-lint
make react-build
```

Then verify Roadmap, Resources, and Exams in the browser at desktop and mobile
breakpoints. Check for horizontal overflow, text clipping, and editor mounting
behavior.
