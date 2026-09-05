# React and Next.js

Use this reference for component composition, hooks, App Router or Pages Router changes, server/client boundaries and frontend data flow.

## React

- Prefer composition and explicit props over hidden coupling.
- Keep render logic pure; synchronize external systems in effects only when necessary.
- Derive values during render instead of storing redundant state.
- Keep hooks at stable call sites and give custom hooks one coherent responsibility.
- Use stable identifiers for list keys; do not use array indexes when order can change.
- Model loading, empty, error and success states explicitly.

## Next.js

- Confirm the router and framework version before choosing APIs.
- Keep server components as the default where supported; add client boundaries only for browser APIs, client state or interactive hooks.
- Keep secrets, privileged data access and authorization checks on the server.
- Treat route handlers and server actions as external boundaries: validate input and authorize mutations.
- Use framework-native metadata, navigation, caching and error/loading boundaries when they fit the repository.
- Avoid turning an entire page tree into client components because one leaf is interactive.

## Checks

- Data fetching happens at the narrowest sensible boundary.
- Hydration output is deterministic.
- Mutations invalidate or update relevant server-state caches.
- Error boundaries and pending states match the user flow.
- Client bundles do not contain server-only dependencies or secrets.
