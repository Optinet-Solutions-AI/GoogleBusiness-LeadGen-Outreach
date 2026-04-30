# Project Skills

Each subfolder defines a Claude Code skill scoped to this project. Invoke any of them with `/<skill-name>` once Claude Code is configured to load this folder.

| Skill | Purpose |
|-------|---------|
| `pipeline-runner` | Walk operator through running a full batch end-to-end |
| `lead-qualifier` | Apply filter rules to a CSV / DB and report which leads to drop |
| `site-generator` | Generate or regenerate one demo site, debug template issues |
| `template-component-hunter` | Find and install premium UI components (21st.dev / typeui.sh / getdesign.md) into the niche templates |
| `outreach-composer` | Compose / refine cold-email sequences for Instantly |
| `status-reporter` | Read recent activity and write the weekly `docs/status/` entry |

## How to add a new skill

1. Create `skills/<kebab-name>/SKILL.md` with this frontmatter:
   ```markdown
   ---
   name: kebab-name
   description: One-sentence trigger description (what task should invoke this)
   ---
   ```
2. Body: clear instructions to Claude — what to read, what to ask, what to call.
3. Reference the relevant workflow under `workflows/` so the skill stays a thin orchestrator on top of an SOP.

## How Claude Code finds these skills

Add this folder to the Claude Code skills path (settings → skills → additional paths) or symlink it into `~/.claude/skills/`. Skills under this directory are project-scoped, so they only show up when working in this repo.
