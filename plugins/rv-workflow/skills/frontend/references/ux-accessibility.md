# UX and Accessibility

Use this reference for user flows, forms, navigation, semantics, keyboard behavior, focus, content clarity and accessibility review.

## Interaction

- Use native semantic elements before recreating behavior with generic containers.
- Every interactive control must be reachable and usable by keyboard.
- Keep focus visible and move or restore it deliberately for dialogs, drawers and route-like transitions.
- Give controls an accessible name and expose state such as expanded, selected, invalid or busy.
- Do not rely on color, hover or motion alone to convey meaning.

## Forms and Feedback

- Associate labels, descriptions and errors with their fields.
- Preserve user input after recoverable validation or network failures.
- Put errors near the cause and summarize them when the form is long.
- Announce asynchronous status changes when visual updates are not otherwise discoverable.
- Confirm destructive or hard-to-reverse actions proportionally to risk.

## Content and Layout

- Maintain logical heading order and landmark structure.
- Provide useful alt text for informative images and empty alt text for decorative images.
- Support zoom, text resizing, high contrast and reduced motion.
- Avoid unnecessary time limits; provide extension or recovery when time is essential.
- Keep targets large enough and avoid gesture-only operations.

## Checks

- Complete the primary flow using only a keyboard.
- Inspect the accessibility tree and form names/states.
- Test loading, error, empty and success announcements.
- Check contrast and reflow at zoomed or narrow layouts.
- Verify focus is not lost, trapped incorrectly or placed behind overlays.
