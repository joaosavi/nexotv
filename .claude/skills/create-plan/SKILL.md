---
name: create-plan
description: Create detailed implementation plans through interactive research and iteration. Use when user says "/create_plan", "create a plan", "plan this feature", "help me plan", "plan before implementing", "quero planejar", or wants a technical specification before writing code. Do NOT use for implementing code (use implement-plan) or for quick single-step tasks that don't need a formal plan.
license: CC-BY-4.0
metadata:
  author: joaosavi
  version: "1.1.0"
---

# Create Plan

Create detailed implementation plans through an interactive, iterative process. Be skeptical, thorough, and work collaboratively with the user to produce high-quality technical specifications.

**STOP at the end of this skill. Do NOT implement the plan, write code, or modify any files.** The user will decide when and how to implement it separately using `implement-plan`.

---

## Project Context

This skill operates within the **iptv-stremio-addon** project — a Stremio addon that proxies IPTV streams from Xtream Codes, IPTV-org, and M3U providers. When researching, always consider how changes interact with:

- `server.js` — Express setup and middleware
- `src/addon/M3UEPGAddon.js` — core class, cache invalidation, data refresh
- `src/addon/builder.js` — Stremio SDK wrappers and handlers
- `src/providers/` — Xtream, IPTV-org, M3U provider logic
- `src/utils/sqliteCache.js` / `src/utils/lruCache.js` — 3-layer caching
- `src/utils/cryptoConfig.js` — token encryption
- Environment variables defined in `.env.example`
- Docker setup: `Dockerfile`, `docker-compose.yml`, `config/` volume mount

---

## Initial Response

When invoked:

1. **If a file path or ticket reference was provided as parameter** — read it fully and begin research immediately.
2. **If no parameters provided**, respond with:

```
I'll help you create a detailed implementation plan. Let me start by understanding what we're building.

Please provide:
1. The task/feature description (or reference to a file)
2. Any relevant context, constraints, or specific requirements
3. Links to related research or previous work

Tip: You can also invoke this with a file directly: /create_plan tmp/tickets/feature.md
```

Then wait for the user's input.

---

## Process

### Step 1 — Context gathering

1. **Read all mentioned files FULLY** — no limit/offset, complete content only. Never delegate this to a subagent before reading yourself.

2. **Spawn parallel research agents** before asking the user anything:
   - `codebase-locator` — find all files related to the task
   - `codebase-analyzer` — understand how the current implementation works
   - `thoughts-locator` — find existing research or notes about this feature (if applicable)

3. **Read all files identified by research** — fully, into main context.

4. **Present informed understanding + focused questions:**

```
Based on the request and my research, I understand we need to [accurate summary].

I've found that:
- [Current implementation detail — file:line reference]
- [Relevant pattern or constraint]
- [Potential complexity or edge case]

Questions my research couldn't answer:
- [Technical question requiring human judgment]
- [Business logic clarification]
```

Only ask questions you genuinely cannot answer through code investigation.

### Step 2 — Research and discovery

After getting clarifications:

1. **If the user corrects a misunderstanding** — spawn new research to verify, don't just accept it. Read the specific files mentioned. Only proceed after verifying.

2. **Spawn parallel sub-tasks** for comprehensive research:
   - `codebase-locator` — find more specific files
   - `codebase-analyzer` — understand implementation details
   - `codebase-pattern-finder` — find similar features to model after

3. **Wait for ALL sub-tasks to complete** before proceeding.

4. **Present findings and design options:**

```
Based on my research:

**Current State:**
- [Key discovery — file:line]
- [Pattern or convention to follow]

**Design Options:**
1. [Option A] — pros/cons
2. [Option B] — pros/cons

**Open Questions:**
- [Technical uncertainty]
- [Design decision needed]

Which approach aligns with your vision?
```

### Step 3 — Plan structure

Once aligned on approach, propose the phased structure and get approval before writing details:

```
Here's my proposed plan structure:

## Overview
[1-2 sentence summary]

## Implementation Phases:
1. [Phase name] — [what it accomplishes]
2. [Phase name] — [what it accomplishes]
3. [Phase name] — [what it accomplishes]

Does this phasing make sense?
```

**Each phase must be independently committable** — meaning the code is in a stable, runnable state after it completes. Design phases accordingly; don't split work in a way that leaves the app broken between commits.

### Step 4 — Write the plan

After structure approval, write the plan to `tmp/plans/YYYY-MM-DD-description.md`.

Use this template:

````markdown
# [Feature/Task Name] Implementation Plan

## Overview

[Brief description of what we're implementing and why — include the business/product reason, not just the technical "what"]

## Motivation & Context

[Why are we making this change now? What problem does it solve? What will break or degrade if we don't do it? This context must be preserved so that anyone reading this plan later — or reviewing a git commit — understands the intent, not just the mechanics.]

## Current State Analysis

[What exists now, what's missing, key constraints — with file:line references]

## Desired End State

[Specification of the desired end state and how to verify it]

### Key Discoveries:

- [Important finding — file:line]
- [Pattern to follow]
- [Constraint to work within]

## What We're NOT Doing

[Explicitly list out-of-scope items to prevent scope creep]

## Documentation Impact

List every doc/config file that must be updated as part of this work. These are not optional — they are part of "done":

| File                           | What changes                                       |
| ------------------------------ | -------------------------------------------------- |
| `README.md`                    | [describe change]                                  |
| `.env.example`                 | [new env vars, removed vars, changed defaults]     |
| `CLAUDE.md`                    | [new architectural notes, changed key files table] |
| `docker-compose.yml`           | [new volumes, env vars, ports]                     |
| `Dockerfile`                   | [new build steps, base image, exposed ports]       |
| `.gitignore` / `.dockerignore` | [new paths to ignore]                              |
| `config/` examples             | [new config fields or changed structure]           |
| `agent.md` / skill files       | [if the agent workflow changes]                    |

Remove rows that genuinely don't apply. Add rows for any files not listed above that will need updates.

## Implementation Approach

[High-level strategy and reasoning — explain *why* this approach over alternatives]

---

## Phase 1: [Descriptive Name]

### Overview

[What this phase accomplishes and why it's the right first step]

### Motivation for this phase

[Why this phase exists separately — what would go wrong if we merged it with another phase, or skipped it]

### Changes Required:

#### 1. [Component/File Group]

**File**: `path/to/file.ext`
**Changes**: [Summary of what changes and why]

```language
// Specific code to add/modify
```

### Documentation Updates for This Phase:

- [ ] `README.md` — [describe what to update]
- [ ] `.env.example` — [new vars added]
- [ ] `CLAUDE.md` — [if architecture section needs updating]
- [ ] _(add or remove as needed)_

### Commit for This Phase:

**Message**: `[type]: [short description of what phase 1 delivers]`
**Why commit here**: [The system is in a stable, testable state. Rolling back to before this phase is meaningful if phase 2 causes issues.]

### Success Criteria:

#### Automated Verification:

- [ ] Server starts cleanly: `npm start`
- [ ] No linting errors: `npm run lint` _(if configured)_
- [ ] _(add project-specific checks)_

#### Manual Verification:

- [ ] [Specific behavior to verify]
- [ ] [Edge case to check]
- [ ] No regressions in related features

**Implementation Note**: After automated verification passes, pause for manual confirmation before proceeding to the next phase.

---

## Phase 2: [Descriptive Name]

[Same structure as Phase 1...]

---

## Testing Strategy

### Manual Testing Steps:

1. [Specific verification step]
2. [Another step]

### Edge Cases to Verify:

- [Edge case + how to trigger it]

## Performance Considerations

[Any performance implications — particularly relevant for cache TTL, stream URL generation, EPG parsing, or provider fetch frequency]

## Migration Notes

[If applicable — how to handle existing cached data, token format changes, breaking config changes, or Docker volume compatibility]

## Rollback Plan

[If something goes wrong after deploying, how do we roll back? Which commits can be reverted cleanly?]

## References

- Original request: _(if a ticket or file was provided)_
- Similar implementation: `[file:line]`
- Related env vars: _(list any that are affected)_
````

### Step 5 — Review and iterate

Present the plan location and ask for feedback:

```
I've created the implementation plan at:
`tmp/plans/YYYY-MM-DD-description.md`

Please review:
- Are the phases properly scoped so each one can be committed independently?
- Is the motivation/context section clear enough to understand later?
- Are all documentation files listed in the Documentation Impact table?
- Are the success criteria specific enough?
- Missing edge cases or considerations?
```

Iterate until the user is satisfied. **Then stop — do not implement, do not modify any source files.**

---

## Guidelines

**Be skeptical** — question vague requirements, identify potential issues early, verify with code, don't assume.

**Be interactive** — don't write the full plan in one shot; get buy-in at each major step; allow course corrections.

**Be thorough** — read all context files COMPLETELY before planning; research actual code patterns in parallel; include specific file:line references; write measurable success criteria.

**Always explain the why** — every phase, every significant change, every design decision must have a reason. Future readers (and future you) will need to understand intent, not just mechanics. A git commit message like "update cache" is useless; "fix: reduce SQLite GC frequency to prevent lock contention under high load" is not.

**Documentation is part of done** — if `.env.example`, `README.md`, `CLAUDE.md`, `docker-compose.yml`, or any other config/doc file needs updating, that update belongs in the plan. It is not a nice-to-have.

**Commit per phase** — each phase in the plan must include an explicit commit step with a proposed commit message. Phases must be designed so the codebase is stable and runnable after each commit. This is what makes it safe to roll back.

**No open questions in the final plan** — if unresolved questions exist, STOP and resolve them before writing. Every decision must be made before finalizing.

**Success criteria must always separate:**

- **Automated verification** — commands that can be run: `npm start`, `npm test`, etc.
- **Manual verification** — UI/UX functionality, Stremio addon behavior, stream playback, EPG display
