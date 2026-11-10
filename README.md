# jenkins-cli

`jenkins-cli` is a Bun-based CLI for self-hosted Jenkins instances.

## Install

Run without installing:

```bash
npx -y @vforsh/jenkins-cli --help
bunx @vforsh/jenkins-cli --help
```

Install globally:

```bash
npm install -g @vforsh/jenkins-cli
jenkins --help
```

For local development:

```bash
git clone git@github.com:vforsh/jenkins-cli.git
cd jenkins-cli
bun install
bun link
jenkins --help
```

## Get an API Token

For a Jenkins user account:

1. Sign in to your Jenkins instance.
2. Open your user settings.
3. Go to your personal security page:
   `/me/security/`
4. If your Jenkins UI does not show API tokens there, check your personal configuration page instead:
   `/me/configure`
5. In the API token section, create a new token.
6. Copy it immediately and store it somewhere safe.

Then configure the CLI:

```bash
jenkins cfg set endpoint=https://jenkins.example.com username=alice
jenkins cfg set api-token
printf '%s' "$JENKINS_TOKEN" | jenkins cfg set api-token -
jenkins doctor
```

Notes:

- Jenkins recommends API tokens for scripted clients instead of your real password.
- Requests authenticated with an API token are generally exempt from CSRF crumb requirements.
- Most Jenkins setups only show the raw token value once, so if you lose it, create a new one and revoke the old token.

## Auth and Config

The CLI resolves config in this order:

1. Explicit global flags (where supported)
2. Environment variables
3. `~/.config/jenkins/config.json`

Supported env vars:

- `JENKINS_ENDPOINT`
- `JENKINS_USERNAME`
- `JENKINS_API_TOKEN`
- `JENKINS_TIMEOUT_MS`
- `JENKINS_RETRIES`
- `JENKINS_REGION`

Configure it interactively, or pass secrets through stdin for scripts:

```bash
jenkins cfg set endpoint=https://jenkins.example.com username=alice
jenkins cfg set api-token
printf '%s' "$JENKINS_TOKEN" | jenkins cfg set api-token -
jenkins cfg ls
jenkins doctor
```

Export and import for machine setup:

```bash
umask 077
jenkins cfg export --json > config.json
jenkins cfg import --json < config.json
```

Both commands require the global `--json` flag, which can appear before or after
the subcommand. Export includes the API token in the standard `{ "ok": true,
"data": { ... } }` envelope; keep exported files private. Import replaces the
saved config and accepts either that envelope or a plain config object. Invalid
JSON, unknown keys, and failed or malformed envelopes are rejected without
changing the saved config.

To copy config to another machine over SSH without a temporary file:

```bash
set -o pipefail
jenkins cfg export --json | ssh macbook 'umask 077; jenkins cfg import --json'
```

## Observe a pushed commit

```bash
SHA=$(git rev-parse HEAD)
jenkins build watch team/app --commit "$SHA" --wait-timeout 20m --check --json
```

`watch` waits for a build to appear, pins the newest matching build, then waits
for completion. It never triggers builds. Match either a checked-out SHA
(`--commit`, minimum 7 hex characters), a number strictly after a baseline
(`--after`), or both. Capture the baseline before pushing. Changelog entries
are not used as evidence of the checked-out revision. For multi-repository
builds, `--repository <exact-url>` restricts SHA matching. Missing metadata
produces `SCM_UNAVAILABLE`; ambiguous prefixes require a longer SHA.

The search examines the latest 100 builds per poll (`--limit` overrides).
For an associated deploy, add its job:

```bash
jenkins build watch team/app --commit "$SHA" \
  --downstream-job team/dev-deploy --wait-timeout 20m --check --json
```

Only a child whose Jenkins upstream cause names the pinned parent is selected.
The returned build is the deploy, with `related.upstream` identifying the parent.
A failed parent stops the chain with exit 9. The wait budget covers the whole
chain, including discovery, queueing, execution and deploy completion.

## Inspect builds and relationships

```bash
jenkins jobs ls team --recursive --json
jenkins jobs info team/app --parameters --json
jenkins build ls team/app --limit 5 --json
jenkins build info 'team/app#123' --include scm,related,stages \
  --downstream-job team/dev-deploy --json
jenkins build info 'team/app#123' --include scm \
  --fields ref,result,scm.revisions.sha --json
jenkins result 'team/app#123' --check --json
```

Build inspection includes `ref`, `state`, `complete`, result, timing and
parameters. Queue inspection returns `state: "queued"`, its reason and blocking
flags until a build is assigned; queueing is not an API error.

Optional sections:

- `scm`: checked-out revisions with repository, SHA, branches and source, plus
  changelog entries. `available: false` means revision metadata is missing.
- `related`: causes, upstream builds, and downstream builds in explicitly named
  jobs. Repeat `--downstream-job` to search multiple jobs. The search examines
  50 recent builds per job (`--related-limit` overrides); its scope and possible
  truncation are returned in `downstreamSearch`. No global job scan occurs.
- `stages`: Pipeline REST API stage names, status and timing; `available: false`
  and a reason explain a missing plugin/API or denied access.

## Trigger and wait

```bash
jenkins build trigger team/app --param ENV=staging --param VERSION=latest \
  --wait --wait-timeout 20m --check --progress --json
jenkins build trigger team/app --params-json '{"ENV":"staging"}' --json
jenkins wait queue:123 --wait-timeout 20m --check --progress --json
```

Inspect parameter definitions with `jobs info --parameters` before triggering.
Without `--wait`, the trigger returns a queue ref. With it, the result contains
`data.triggered` and `data.build`. Trigger POSTs are never automatically retried
after a network failure, since the server may already have queued the build.

`--progress` writes phase updates to stderr, keeping stdout machine-readable.
A timeout does not cancel or retrigger a build. Resume with the exact ref in
`error.details`, or the same watch selectors.

## Bounded logs and continuation

```bash
jenkins build logs 'team/app#123' --tail 80 --max-bytes 12000 --json
jenkins build logs 'team/app#123' --grep 'ERROR|Exception|FAILED' --context 3 --json
jenkins build logs 'team/app#123' --cursor "$CURSOR" --json
jenkins build logs 'team/app#123' --follow --wait-timeout 20m
```

JSON data contains `text`, `ref`, `complete`, `truncated`, `filtered`, `cursor`,
and legacy `nextStart`. JSON output defaults to a 65536-byte text cap, keeping
the end. Selectors run in order: JavaScript regex grep with context, tail lines,
then byte cap. Regex matching is case-sensitive. `--context` requires `--grep`.

Pass the returned cursor unchanged to read only new data. A cursor belongs to
one build and cannot be combined with legacy `--start`. It resumes after all
fetched text, including text omitted by filtering or caps. To inspect omitted
history, omit the cursor and change the selectors. Grep context does not cross
cursor boundaries. Tail/grep bound output; cursors also avoid downloading old
log content again. Offsets come from Jenkins, not decoded text length.

Raw human/plain `--follow` streams chunks. JSON and filtered human follow
return a selected snapshot on completion. Follow retains at most 4 MiB of text;
dropped history sets `truncated`. A log wait timeout includes a cursor in
`error.details` after a build is resolved. Buffered output replays from the last
delivered offset on timeout, so resuming does not skip unseen text. `--max-bytes` overrides the returned
text cap; filtered human snapshots also default to 65536 bytes.

## Artifacts

```bash
jenkins artifacts 'team/app#123' --json
jenkins artifacts team/app --json
jenkins artifacts 'team/app#123' --download dist/public.zip --output ./public.zip
jenkins artifacts 'team/app#123' --download-all ./artifacts
```

A job path/URL selects its latest build. Prefer a pinned ref for a specific
build's results. Plain paths always name jobs, including numeric branch names
like `team/123`; use `team/app#123` or a build URL for an explicit build.
Downloads accept an exact relative path or unique filename.
`--download-all` preserves relative paths inside the destination directory.

## Timeouts and output contract

- `--request-timeout 30s`: each HTTP request, including body consumption.
- `--wait-timeout 20m`: one total observation budget (default 10m), shared
  across queue/build and, for watch, discovery and downstream execution.
- Durations accept `ms`, `s`, `m`, `h`; bare numbers mean milliseconds.
- `--timeout <integer-ms>` remains an HTTP-only legacy option. Values like
  `55s` are rejected rather than partially parsed; use `--wait-timeout 55s`.
- `--wait-timeout-ms <integer-ms>` remains supported. Do not combine old and
  new spellings of the same setting. Polling uses `--poll-ms` (default 2000).
- Integers and durations are strictly validated; zero polling is rejected.

Default output is human-readable; `--plain` preserves stable line-based
output. `--json` always emits one envelope, including usage failures:

```json
{"ok": true, "data": {"ref": "team/app#123", "state": "finished", "complete": true, "result": "SUCCESS"}}
```

```json
{"ok": false, "error": {"code": "UNKNOWN_COMMAND", "message": "unknown command", "exitCode": 2, "hint": "Run jenkins help --json for command syntax."}}
```

Use `error.code`, not message text. `WAIT_TIMEOUT` includes resumable context
in `error.details` where available. `--fields ref,result,scm.revisions` projects
inside `data`, preserves the envelope, and applies to each array element.
Missing fields are omitted. `--fields` requires `--json`.

`--check` on info/result/wait/watch/trigger-with-wait exits 9 unless the build
has completed with SUCCESS. A completed failed build keeps `ok: true` because
inspection succeeded; an incomplete checked build returns `BUILD_INCOMPLETE`.
Without `--check`, inspecting a failed build still exits 0.

| Exit | Meaning |
| --- | --- |
| 0 | Command succeeded |
| 1 | Runtime failure |
| 2 | Invalid usage |
| 3 | Config error |
| 4 | Access/auth failure |
| 5 | Network failure |
| 6 | Resource not found |
| 7 | API failure |
| 8 | HTTP or wait timeout (`REQUEST_TIMEOUT` / `WAIT_TIMEOUT`) |
| 9 | Unsuccessful, cancelled or incomplete checked build |

Accepted refs: `queue:123`, queue/build URLs, `team/app#123`, `team/app/123`.
Multibranch job paths retain Jenkins encoding, e.g. `feature%2Fname`; URLs
usually contain `feature%252Fname`. Prefer returned refs instead of re-encoding.

## Help and agent skill

```bash
jenkins help build watch --json
jenkins help build logs --json
jenkins skill
```

Structured help describes actual arguments, options and subcommands. Aliases:
`b` for build, `job` for jobs, `get`/`show` for info, `log` for logs, `run` for
trigger. `jenkins builds` is not a command.

The bundled [agent skill](skill/jenkins/SKILL.md) contains complete push/watch,
resume, deploy, failure diagnosis and artifact workflows. `jenkins skill`
prints its install URL for `npx skills add`.
