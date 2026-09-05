# Executing Plans

Load the accepted plan, check it for missing prerequisites or unsafe assumptions, and stop for user direction only when a material mismatch changes the intended result. Otherwise execute in dependency order. Keep each step small enough to verify and preserve the plan's contracts rather than mechanically following stale details.

At each meaningful checkpoint, run the specified validation and report actual evidence. Update the plan or task record when reality differs, explaining why. Do not silently skip steps, broaden scope, or claim completion from code inspection alone. If subagents are explicitly authorized and the plan has independent tasks, route through the bundled parallel or subagent workflow; otherwise execute locally.
