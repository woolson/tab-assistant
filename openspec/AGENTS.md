# OpenSpec Workflow for Tab Assistant

## OpenSpec Workflow
This project uses OpenSpec for spec-driven development. Follow these steps:

### 1. Create a Change Proposal
When starting a new feature or bug fix, create a change proposal:
```
Please create an OpenSpec change proposal for [feature description]
```

This will create:
- `openspec/changes/[change-name]/proposal.md` - Why and what changes
- `openspec/changes/[change-name]/tasks.md` - Implementation checklist
- `openspec/changes/[change-name]/specs/*.md` - Spec deltas

### 2. Review & Refine
Review the proposal and iterate on specs until aligned:
```
Can you add acceptance criteria for [feature]?
```

### 3. Implement Tasks
Once specs are approved, implement the change:
```
The specs look good. Let's implement this change.
```

Work through tasks in `openspec/changes/[change-name]/tasks.md`.

### 4. Archive the Change
After implementation is complete:
```
Please archive the change
```

This merges the spec deltas into `openspec/specs/` and moves the change to `openspec/archive/`.

---

## Current Active Changes
Run `openspec list` to see active changes.

---

## Project Context
Read `openspec/project.md` for project details and conventions.

---

## AI Commit Convention
All AI-generated commits should follow Conventional Commits and include:
- Type: `feat`, `fix`, `docs`, `refactor`, etc.
- AI identifier: `(ai: aidai) 🤔`
- Example: `feat: add group management (ai: aidai) 🤔`

---

## Available OpenSpec Commands
(If using Claude Code, CodeBuddy, Cursor, Codex, Qoder, RooCode)
- `/openspec:proposal` - Create a new change proposal
- `/openspec:apply` - Implement the current change
- `/openspec:archive` - Archive a completed change

(For other AI tools, use natural language requests)
- "Create an OpenSpec change proposal for..."
- "Apply the OpenSpec change..."
- "Archive the change..."
