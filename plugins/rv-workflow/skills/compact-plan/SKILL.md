---
name: compact-plan
description: Create concise implementation plans for requests such as 계획 세워줘, 구현 순서 정리해줘, or plan this change, and for work whose sequence needs review. Skip planning for simple, clear, low-risk execution requests; formal specifications belong to planner.
---

# Compact Plan

Produce the smallest plan that lets the user review scope and execution order.

Use this skill naturally when planning is warranted; the user does not need to name it or ask for a short plan. Match the user's language.

## Decide Whether to Plan

- For a simple, clear, low-risk execution request, perform the authorized work directly using the relevant role. Skip plan output, plan files, approval pauses for a plan, and task tracking unless explicitly requested. Examples include a wording fix, a routine localized edit, a file lookup or a routine commit.
- Write a compact plan when the user asks for one or when a non-obvious sequence needs review. Multiple files or commands alone do not justify a plan. Do not manufacture steps to fit the output format.

## Policy Conflicts

Check the proposed change against relevant existing repository, product and business policies. If a concrete conflict exists, add a brief review note with the policy and its source, the conflicting change, its impact and a proposed adjustment. Ask the user to review and approve the resolution before proceeding with affected work, including otherwise simple tasks; do not silently override the policy. Unaffected, authorized work may continue.

Do not repeat review for the same resolution the user has already explicitly approved, or add this approval step when there is no concrete conflict. Keep the review note within the plan's length budget when producing a plan.

## Output

- Start with a one-sentence goal.
- Write three to seven numbered steps, with one sentence per step.
- End with one concise verification line.
- Keep the complete plan under 250 words unless the user requests more detail.

Name files or modules only when they are known from repository evidence. Combine closely related edits and checks into one step. Include an assumption only when it materially affects the plan, and keep it to one sentence.

Omit background essays, exhaustive file inventories, alternative designs, timelines, task DAGs, risk registers, code snippets and repeated acceptance criteria. Do not invoke a Superpowers planning workflow merely because the user asked for a plan.

For a large task, keep the overview within the same budget and detail only the next reviewable slice. Use a formal specification instead only when unresolved product decisions, cross-role contracts, high risk or repository policy genuinely require one.

Stop after presenting the plan unless the user also asked for implementation.
