# Frontend CLAUDE.md

## Stack

- Angular
- TypeScript
- Tailwind CSS
- Generated OpenAPI client from the backend
- SPA architecture

## API integration

- Use the generated OpenAPI client and generated types.
- Do not duplicate backend DTOs manually.
- Do not create parallel hand-written HTTP clients for endpoints already represented by the generated client.
- Keep API integration isolated from presentation components.

## Angular / TypeScript

- Write idiomatic Angular rather than translating React patterns into Angular.
- Use strict TypeScript.
- Do not use `any`.
- Avoid unsafe casts used merely to silence the compiler.
- Prefer signals / RxJS / Angular primitives according to the problem rather than introducing a global state library by default.
- Configure and respect linting.
- Keep components focused and reasonably sized.
- Extract reusable components when there is genuine reuse or a meaningful UI boundary.
- Avoid giant page components and duplicated presentation logic.

## Accessibility

- Prefer semantic HTML and native browser behavior first.
- Use Angular CDK accessibility utilities when richer accessible interactions require them.
- Interactive controls must work with keyboard and pointer input.
- Important information must not be available only on hover.
- Tooltips/popovers should support focus as well as hover.
- Maintain appropriate labels, roles, focus behavior, and contrast.

## UX / product thinking

Do not mechanically render API fields.

Before implementing a dashboard or visualization, consider:

- What question is the user trying to answer?
- Which information deserves immediate visual priority?
- What requires exact numbers versus visual comparison?
- Would a chart materially improve understanding?
- Would a table be more precise?
- Are both useful for different purposes?
- Can deterministic insights surface something actionable?
- Does explanatory hover/focus content reduce clutter without hiding critical information?

For DASH-247 specifically, the UI should make it easy to answer:

1. Is recent activity normal?
2. Which location needs attention?
3. Why is something being classified as above, below, or typical?

Prefer strong information hierarchy over decorative visual polish.

## State

- Keep state management lightweight.
- Persist required user-controlled dashboard state in a deliberate way.
- Prefer URL/query state when it improves reload persistence, shareability, or browser navigation.

## Error states

Explicitly handle:

- loading
- API errors
- empty data
- insufficient historical data
- zero activity

Do not rely on a global error handler for expected API failures.

## Verification

After meaningful frontend changes:

- run lint
- run build
- run relevant tests
- manually verify important interaction and accessibility states