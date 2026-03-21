---
name: implement-plan
description: Implement an approved technical plan from tmp/plans/ with phase-by-phase verification and human checkpoints. Use when user says "/implement_plan", "implement this plan", "execute the plan", "start implementing", "implementa o plano", or references a plan file. Do NOT use for creating plans (use create-plan) or for implementing without a written plan file.
license: CC-BY-4.0
metadata:
  author: joaosavi
  version: "1.1.0"
---

# Implement Plan

Implement an approved technical plan from `tmp/plans/` with phase-by-phase execution, automated verification, commit per phase, and human checkpoints between phases.

## Getting Started

When given a plan path:

1. Read the plan completely — check for any existing checkmarks (`- [x]`) to understand what's already done
2. Read all files mentioned in the plan **fully** — never use limit/offset, complete context is required
3. Re-read the **Motivation & Context** section of the plan to understand *why* these changes are being made — this must inform commit messages and any decisions you make when adapting to mismatches
4. Create a task list to track progress
5. Begin implementing from the first unchecked item

If no plan path was provided, ask for one before proceeding.

---

## Implementation Philosophy

Plans are carefully designed, but reality can be messy. Your job is to:

- Follow the plan's **intent** while adapting to what you actually find in the code
- Complete each phase fully before moving to the next
- Verify your work makes sense in the broader codebase context
- Update checkboxes in the plan file as you complete sections (`- [ ]` → `- [x]`)

When things don't match the plan exactly, communicate clearly — don't silently adapt in ways that change scope or behavior.

### Mismatch protocol

When the plan can't be followed as written:

```
Issue in Phase [N]:
Expected: [what the plan says]
Found:    [actual situation in the code]
Why this matters: [explanation of the impact]

How should I proceed?
```

Stop and wait for guidance. Do not improvise around a mismatch without flagging it.

---

## Verification After Each Phase

After implementing a phase:

1. Run the **automated success criteria** listed in the plan
2. Fix any failures before declaring the phase done
3. Check off completed items in the plan file using Edit
4. **Apply documentation updates** listed for this phase — do not defer these to the end
5. **Commit** using the message proposed in the plan (see Commit Protocol below)
6. **Pause for human verification** using this format:

```
Phase [N] Complete — Committed and Ready for Manual Verification

Automated verification passed:
- [List of automated checks that passed]

Documentation updated:
- [List of doc/config files updated this phase]

Commit: [commit hash or message]

Please perform the manual verification steps from the plan:
- [List manual verification items]

Let me know when manual testing is complete so I can proceed to Phase [N+1].
```

Do not check off manual testing items until the user confirms they passed.

**Exception**: if the user instructs you to execute multiple phases consecutively, skip the pause between phases but still commit after each phase and only pause for manual verification after the last one.

---

## Commit Protocol

Each phase ends with a commit. Use the message proposed in the plan's "Commit for This Phase" section. If the plan doesn't specify one, derive a message following this format:

```
<type>: <short description of what this phase delivers>

<why — one sentence summarizing the motivation from the plan's context section>
```

**Good example:**
```
feat: add per-provider cache TTL configuration

Allows operators to tune M3U/Xtream/IPTV-org refresh rates independently, fixing stale EPG data in long-running deployments.
```

**Bad example:**
```
update cache
```

The commit message must be self-explanatory to anyone reading `git log` without the plan. The *why* is as important as the *what*.

Commit only files that belong to this phase. Do not batch unrelated changes.

---

## Documentation Updates

Every phase in the plan has a "Documentation Updates for This Phase" checklist. These are **not optional** — treat them as part of the phase implementation, not a post-step.

Files that commonly need updating in this project:

| File | When to update |
|------|---------------|
| `README.md` | New features, changed behavior, new env vars |
| `.env.example` | Any new or removed environment variable |
| `CLAUDE.md` | Changed architecture, new key files, new patterns |
| `docker-compose.yml` | New volumes, ports, env vars, service changes |
| `Dockerfile` | New build steps, base image changes, exposed ports |
| `.gitignore` / `.dockerignore` | New generated files, new data directories |
| `config/` examples | New config fields or changed structure |

If you discover during implementation that additional files need updating beyond what the plan listed, update them and note this in the phase completion message.

---

## Resuming Interrupted Work

If the plan already has checkmarks:

- Trust that completed work is done — don't re-verify unless something seems off
- Pick up from the first unchecked item
- Re-read relevant files around the resume point for context
- Check git log to confirm which commits have already been made for completed phases

---

## If You Get Stuck

When something isn't working as expected:

1. Make sure you've read and fully understood all relevant code in context
2. Consider whether the codebase has evolved since the plan was written
3. Present the mismatch clearly (see mismatch protocol above) and ask for guidance

Use sub-agents sparingly — only for targeted debugging or exploring unfamiliar territory that would bloat the main context.

---

## Opening the Pull Request

After the user confirms the final manual verification step, open a PR using `gh pr create`. Before running the command, gather:

1. **`git log main..HEAD --oneline`** — list of all commits in this branch
2. **`git diff main..HEAD --stat`** — files changed summary
3. The plan's **Overview**, **Motivation & Context**, and **What We're NOT Doing** sections

Build the PR description from this material. It must be detailed enough that a reviewer unfamiliar with the plan can understand the full scope and rationale without needing to read the plan file.

### PR description template

```markdown
## Why

[2-4 sentences from the plan's Motivation & Context. What problem does this solve? Why now?]

## What changed

[One bullet per phase, summarizing the concrete changes made. Include file names where helpful.]

- **Phase 1 — [name]**: [what was done]
- **Phase 2 — [name]**: [what was done]
- ...

## Documentation updates

[List every doc/config file updated: README, .env.example, CLAUDE.md, docker-compose.yml, etc.]


## Commits

[Paste the output of `git log main..HEAD --oneline`]

```

Use `gh pr create --base main --title "..." --body "$(cat <<'EOF' ... EOF)"` so the formatting is preserved exactly.

After the PR is created, post the URL to the user.

---

## Definition of Done

A phase is done when:
- All automated checks pass
- Checkboxes in the plan are updated
- Documentation updates for this phase are applied
- Commit is made with a meaningful message that captures the *why*
- Human confirms manual verification (if applicable)

The plan is fully implemented when:
- All phases are done
- User has confirmed the final manual verification step
- All documentation files in the plan's "Documentation Impact" table are updated
- PR is open with a detailed description
