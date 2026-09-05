# Component and Design Direction

Use this reference for component APIs, visual systems, redesigns, responsive layout and interaction polish.

## Read the Brief

Infer the product type, audience, brand assets, visual references and trust or accessibility constraints before choosing an aesthetic. Preserve an existing design language during focused changes; audit it before a broad redesign.

Avoid defaulting to fashionable treatments without evidence from the brief. Generic gradient heroes, interchangeable card grids and decorative motion are not a design direction.

## System First

- Reuse the repository's design system and tokens before adding new primitives.
- Choose one component foundation rather than mixing incompatible systems.
- Define component variants around semantic purpose and state.
- Keep spacing, type, color, radius, shadow and motion decisions tokenized when repeated.
- Include hover, focus, active, disabled, loading, empty and error states where relevant.
- Prefer real content constraints over sample-perfect layouts.

## Responsive Behavior

- Design for content reflow, not just narrower widths.
- Prevent fixed-width children, long strings and media from forcing overflow.
- Keep primary actions and critical information available at small sizes.
- Validate touch targets and interactive spacing on coarse pointers.

## Checks

- Component APIs express user intent instead of exposing styling internals.
- Visual hierarchy supports the primary task.
- Motion communicates state and respects reduced-motion preferences.
- Layout works with long, missing and localized content.
- New styling is consistent with the surrounding product.
