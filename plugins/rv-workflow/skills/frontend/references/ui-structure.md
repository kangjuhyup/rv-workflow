# UI Structure

Use this reference for directory boundaries, imports, feature slicing and state ownership.

## Default Boundaries

- Routes or pages compose screens and own routing concerns.
- Feature modules own feature-specific data access, state, containers and composed UI.
- Reusable components stay feature-independent and receive data and callbacks through props.
- Shared modules contain cross-feature non-visual utilities, configuration and adapters.
- Tests live where the repository convention expects and mirror source structure when practical.

A common direction is:

```text
routes -> feature containers -> feature UI -> reusable components
feature data/state -> shared infrastructure
reusable components -> shared utilities
```

Reusable components must not import feature stores, queries or feature model types. Feature containers adapt feature data into component-local view models.

## State Ownership

- Server state belongs in the repository's query/cache layer.
- Local interaction state stays local until sharing is required.
- Cross-component client state belongs in the smallest feature or app scope that owns it.
- Do not duplicate server data into a client store without an explicit editing or offline model.

## Checks

- Route files remain thin.
- Import direction does not create feature-to-feature cycles.
- Generic components are named and typed without feature coupling.
- Feature-specific composition stays inside the feature boundary.
- Large screens are split by coherent responsibilities, not arbitrary line counts.
