# KooAgent Git Management

This repository is managed as an integration repository for two independently developed codebases:

- `Operit`
- `CoreCoder`

## Repository Roles

- Keep upstream project repositories as read-oriented sources.
- Keep personal development changes on personal branches/remotes.
- Use `SpikeX-21/KooAgent` as the integration and backup repository.
- Treat `main` in `SpikeX-21/KooAgent` as the stable integrated snapshot branch.

## Local Codebase Branches

The two local codebases may each keep their own active development branch. For the current integration line, both local repositories use:

```text
feature/remote-tool-minimal-loop
```

Because these are separate Git repositories, do not push both repositories to the same remote branch name. Use project-prefixed branches in `SpikeX-21/KooAgent`:

```text
operit/feature-remote-tool-minimal-loop
corecoder/feature-remote-tool-minimal-loop
```

## Remotes

For each child repository:

- Keep `origin` pointing at the original upstream repository.
- Add `kooagent` pointing at the personal integration repository:

```bash
git remote add kooagent git@github.com:SpikeX-21/KooAgent.git
```

If the remote already exists, verify it with:

```bash
git remote -v
```

## Development Flow

1. Develop and commit inside the relevant child repository.
2. Push child repository work to the project-prefixed branch in `SpikeX-21/KooAgent`.
3. When both child repositories reach a stable compatible state, update the integrated `main` snapshot in `SpikeX-21/KooAgent`.

Recommended push commands:

```bash
# From Operit
git push kooagent HEAD:refs/heads/operit/feature-remote-tool-minimal-loop

# From CoreCoder
git push kooagent HEAD:refs/heads/corecoder/feature-remote-tool-minimal-loop
```

## Daily Development Procedure

Use the child repositories as the normal development workspaces. Do not develop directly in the integrated snapshot unless the change is only about repository management documentation or integration metadata.

### Operit changes

```bash
cd /Users/spike21/workspace/code/kooagent/Operit
git status --short --branch
git add <changed-files>
git commit -m "<message>"
git push kooagent HEAD:refs/heads/operit/feature-remote-tool-minimal-loop
```

### CoreCoder changes

```bash
cd /Users/spike21/workspace/code/kooagent/CoreCoder
git status --short --branch
git add <changed-files>
git commit -m "<message>"
git push kooagent HEAD:refs/heads/corecoder/feature-remote-tool-minimal-loop
```

### Cross-repository changes

When a feature touches both repositories:

1. Commit the `Operit` side in the `Operit` repository.
2. Commit the `CoreCoder` side in the `CoreCoder` repository.
3. Push both child repositories to their project-prefixed branches.
4. Record compatible commit SHAs in the task, PR, or release note when needed.
5. Update the integrated `main` snapshot only after the two sides have been tested together.

The preferred mental model is:

```text
child repo branch = active development and review
KooAgent main     = stable integrated snapshot
```

## Integrated Snapshot Update Procedure

After child repository branches have been pushed and the combined behavior is stable, refresh the `KooAgent/main` snapshot from the child repositories, then commit and push the snapshot.

The snapshot should represent a known-good pair of child repository states, not every small local edit.

## Integrated Snapshot Rule

The `main` branch in `SpikeX-21/KooAgent` should contain a stable snapshot layout:

```text
KooAgent/
  Operit/
  CoreCoder/
```

Only update this snapshot after the child branches have been committed and pushed.

## Safety Rules

- Do not force-push shared branches unless explicitly decided.
- Do not push local changes to upstream `origin` unless intentionally contributing back to the original project.
- Do not commit build outputs, dependency caches, or `.git` directories into the integrated snapshot.
- Before pushing, check for oversized files:

```bash
find . -type f -size +95M -print
```

- Before committing, check status:

```bash
git status --short --branch
```
