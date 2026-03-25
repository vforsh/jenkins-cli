---
name: jenkins
description: Use the jenkins CLI to inspect jobs, trigger builds, stream logs, wait for completion, and manage config for self-hosted Jenkins instances.
---

# jenkins

## Quick start

```bash
jenkins cfg set endpoint=https://jenkins.example.com username=alice
printf '%s' "$JENKINS_TOKEN" | jenkins cfg set api-token -
jenkins doctor
```

## Commands

- `jenkins jobs ls [path]` list jobs at the root or in a folder job
- `jenkins jobs info <job>` inspect one job; add `--parameters` to include parameter definitions
- `jenkins build ls <job>` list recent builds for a job
- `jenkins build info <ref>` inspect one build or queue ref
- `jenkins build trigger <job>` trigger a build, optionally with params
- `jenkins build logs <ref>` print progressive logs
- `jenkins wait <ref>` wait until a queue item or build completes; add `--progress` to stream wait phases
- `jenkins result <ref>` fetch the current build result
- `jenkins cfg ...` manage config
- `jenkins doctor` run readiness checks
- `jenkins skill` print this skill URL

## Parameterized builds

Use repeated `--param KEY=value` flags:

```bash
jenkins build trigger team-folder/app-build \
  --param BUILD_ENV=staging \
  --param VERSION=latest
```

Or pass one JSON object:

```bash
jenkins build trigger team-folder/app-build \
  --params-json '{"BUILD_ENV":"staging","VERSION":"latest"}'
```

Add `--wait` if you want the CLI to block until the build finishes:

```bash
jenkins build trigger team-folder/app-build \
  --param BUILD_ENV=staging \
  --wait \
  --progress
```

Parameter names must match the Jenkins job's parameter names exactly.

Use `jenkins jobs info <job> --parameters` to inspect the available parameter names before triggering a build. When Jenkins exposes them, the CLI includes:

- parameter name
- parameter type
- default value
- choice list
- description

## Wait Progress

Add `--progress` when waiting if you want live phase updates on stderr while keeping the final result on stdout:

```bash
jenkins wait queue:123 --progress
jenkins build trigger team-folder/app-build --wait --progress
```

On `jenkins build trigger`, `--progress` only makes sense together with `--wait`.

The progress stream covers:

- queued: current queue reason and stuck/blocked state
- started: build number and URL
- running: elapsed time versus estimated duration
- finished: final result and build URL

## Global flags

- `--json`
- `--plain`
- `-q`, `-v`
- `--endpoint`
- `--region`
- `--timeout`
- `--retries`

## Ref formats

- `queue:123`
- `https://jenkins.example.com/queue/item/123/`
- `folder/job#123`
- `https://jenkins.example.com/job/folder/job/job-name/123/`

## Common errors

- Exit `1`: runtime failure
- Exit `2`: invalid usage or bad flags
- Exit `3`: config error
- Exit `4`: auth failure
- Exit `5`: network failure
- Exit `6`: Jenkins resource not found
- Exit `7`: Jenkins API rejected the request
- Exit `8`: timeout
