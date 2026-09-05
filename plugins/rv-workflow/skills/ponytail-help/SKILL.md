---
name: ponytail-help
description: >
  Quick-reference card for all ponytail modes, skills, and commands.
  One-shot display, not a persistent mode. Trigger: /ponytail-help,
  "ponytail help", "what ponytail commands", "how do I use ponytail".
---

# Ponytail Help

Display this reference card when invoked. One-shot, do NOT change mode,
write flag files, or persist anything.

## Levels

| Level | Trigger | What change |
|-------|---------|-------------|
| **Lite** | `$rv-workflow:ponytail lite` | Build what's asked, name the lazier alternative in one line. |
| **Full** | `$rv-workflow:ponytail` | The ladder enforced: YAGNI → stdlib → native → one line → minimum. Default. |
| **Ultra** | `$rv-workflow:ponytail ultra` | YAGNI extremist. Deletion before addition. Challenges requirements before building. |

Level sticks until changed or session end.

## Skills

| Skill | Trigger | What it does |
|-------|---------|--------------|
| **ponytail** | `$rv-workflow:ponytail` | Lazy mode itself. Simplest solution that works. |
| **ponytail-review** | `$rv-workflow:ponytail-review` | Over-engineering review: `L42: yagni: factory, one product. Inline.` |
| **ponytail-audit** | `$rv-workflow:ponytail-audit` | Whole-repo over-engineering audit: ranked list of what to delete. |
| **ponytail-debt** | `$rv-workflow:ponytail-debt` | Harvest `ponytail:` shortcut comments into a tracked ledger. |
| **ponytail-gain** | `$rv-workflow:ponytail-gain` | Measured-impact scoreboard: less code, less cost, more speed. |
| **ponytail-help** | `$rv-workflow:ponytail-help` | This card. |

RV Workflow exposes all six through the plugin-qualified `$rv-workflow:<skill>` names above. The persistent `ponytail` mode is explicit-only; the focused one-shot skills may also match their natural-language triggers.

## Deactivate

Say "stop ponytail" or "normal mode". Resume anytime with `$rv-workflow:ponytail`.

The selected level persists for the current conversation only. RV Workflow plugin updates carry Ponytail updates; there is no separate Ponytail runtime or configuration file.

## More

Full docs + examples: https://github.com/DietrichGebert/ponytail
