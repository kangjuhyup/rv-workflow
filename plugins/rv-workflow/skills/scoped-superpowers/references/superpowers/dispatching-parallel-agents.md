# Dispatching Parallel Agents

Dispatch only when at least two substantial workstreams are independent: distinct goals, non-overlapping files or mutable state, no unfinished-result dependency, and enough work to repay coordination cost. Give each agent one bounded ownership area, relevant context, constraints, expected evidence, and a concrete handoff format. Tell implementation agents that other workers share the repository and that they must preserve others' edits.

Start eligible agents together. Continue useful coordinator work that does not overlap their ownership. Treat agent reports as inputs, not proof: inspect integration boundaries, resolve conflicting assumptions, and run fresh verification over the combined result. Do not create agents for microtasks, related symptoms that may share one cause, or work that must proceed sequentially.
