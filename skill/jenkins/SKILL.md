---
name: jenkins
description: Inspect, trigger and watch Jenkins builds by commit; read bounded logs with cursors, inspect SCM and related deploys, download artifacts, and manage Jenkins CLI config.
---

# Jenkins CLI

Prefer `--json`. Every response is `{ "ok": true, "data": ... }` or
`{ "ok": false, "error": { "code", "message", "exitCode", "hint"? } }`.
Read fields under `data`, never at the envelope root. `--fields` selects fields
inside `data`; it preserves the envelope and maps over arrays.

## After pushing: wait for the exact commit

```bash
SHA=$(git rev-parse HEAD)
jenkins build watch "$JOB" --commit "$SHA" --wait-timeout 20m --check --json
```

Requires `--commit` or `--after`; both may be combined. Watches never trigger
builds. The newest matching build is pinned and followed to completion.
A commit matches checked-out Git/SCM metadata, not changelog entries or guesses
from console text. Use the full SHA. For multi-repository jobs, add
`--repository <exact-repository-url>`.

When revision metadata is unavailable, the CLI reports `SCM_UNAVAILABLE`.
If build-number matching is sufficient, capture a baseline **before pushing**:

```bash
jenkins build ls "$JOB" --limit 1 --json --fields number
# Read data[0].number, then push. Substitute that baseline below.
jenkins build watch "$JOB" --after 123 --wait-timeout 20m --check --json
```

Search is bounded to the most recent 100 builds per poll; increase `--limit`
when needed. If several builds share the same revision, the newest is chosen.

## Wait for the associated deploy

```bash
jenkins build watch "$JOB" --commit "$SHA" \
  --downstream-job team/dev-deploy --wait-timeout 20m --check --json
```

The deploy must name the selected build in its upstream cause. This command
returns the deploy build, with `related.upstream` identifying its parent.
The total budget covers finding the build, its execution, finding the deploy,
and the deploy execution. A failed parent stops the chain with exit 9.

## Resume observing an existing build

```bash
jenkins result 'team/app#123' --json
jenkins wait 'team/app#123' --wait-timeout 55s --check --progress --json
jenkins wait queue:456 --wait-timeout 20m --check --json
```

Build data includes `ref`, `state` (`running`/`finished`), `complete`, `result`,
`url`, `number`, `jobPath`, timing, description, and parameters.
A queued item returns `state: "queued"`, `complete: false`, `ref`, `queueId`,
`why`, `blocked`, `stuck`, and `buildable`. Queueing is a normal state.

`WAIT_TIMEOUT` is exit 8, not a failed build. Its `error.details` includes the
last observed state or search selectors where available. Resume with that
exact build ref, or the same watch selectors; **do not trigger again**.
`--progress` writes phase updates to stderr; stdout remains one JSON envelope.

## Inspect revision, stages and deployment relationships

```bash
jenkins build info 'team/app#123' --include scm,related,stages \
  --downstream-job team/dev-deploy --json
jenkins build info 'team/app#123' --include scm \
  --fields ref,result,scm.revisions --json
```

- `scm.available`, `scm.revisions[]`: SHA, repository URL when exposed, branches,
  source. `scm.changes[]` describes changelog entries, not the checked-out SHA.
- `related.upstream[]`: parent refs from Jenkins causes.
- `related.downstream[]`: exact matches in explicitly supplied downstream jobs.
  Repeat `--downstream-job` to search multiple jobs. The search examines 50
  recent builds per job (`--related-limit` overrides); inspect
  `related.downstreamSearch.truncated` before interpreting an empty result.
  Without a downstream job, no server-wide scan is performed.
- `stages.available`, `stages.items[]`: id, name, status and timing. Unavailable
  Pipeline REST API or denied access is reported with a reason, not an empty
  success pretending that the build has no stages.

## Diagnose a failure without dumping the whole log

```bash
jenkins build logs 'team/app#123' --tail 80 --max-bytes 12000 --json
jenkins build logs 'team/app#123' --grep 'ERROR|Exception|FAILED' \
  --context 3 --max-bytes 16000 --json
```

`data` contains `text`, `ref`, `complete`, `truncated`, `filtered`, `cursor`, and
legacy `nextStart`. JSON log text defaults to a 65536-byte cap, keeping its end.
Filters run in order: grep with context, tail, byte cap. `--grep` is a
case-sensitive JavaScript regex, without surrounding `/` delimiters.

For another snapshot, pass the exact cursor returned by the previous response:

```bash
jenkins build logs 'team/app#123' --cursor "$CURSOR" --json
```

Cursors belong to one build and use Jenkins offsets; never calculate them from
text length. A cursor resumes **after all text fetched**, including text omitted
by filters/caps. To inspect omitted history, omit the cursor and change filters.
Tail/grep reduce output; cursor continuation also avoids refetching old log data.
Grep context does not cross cursor boundaries.

`--follow --wait-timeout 20m` waits for log completion. Raw human/plain output
streams; JSON and filtered human output return their selected snapshot when
finished. During follow a rolling 4 MiB buffer bounds retained text; loss of
older text is marked `truncated`. A log wait timeout includes a continuation
cursor in `error.details` once a build has been resolved. On timeout, buffered
output resumes before undelivered text; raw streaming resumes after delivered
chunks. This prevents a failed follow from skipping unseen output.

## Trigger only when a new build is needed

```bash
jenkins jobs info "$JOB" --parameters --json
jenkins build trigger "$JOB" --param BUILD_ENV=staging \
  --wait --wait-timeout 20m --check --progress --json
# Alternative parameter input:
jenkins build trigger "$JOB" --params-json '{"BUILD_ENV":"staging"}' --json
```

Parameter names must match job definitions. Without `--wait`, read
`data.queueId`/`data.queueUrl`, then observe that queue ref. With `--wait`, read
`data.build` (and `data.triggered`). Network failures during a trigger are not
automatically retried: the server may already have queued the build.

## Find jobs and download artifacts

```bash
jenkins jobs ls team --recursive --json
jenkins build ls team/app --limit 5 --json
jenkins artifacts 'team/app#123' --json
jenkins artifacts 'team/app#123' --download dist/public.zip --output ./public.zip
jenkins artifacts 'team/app#123' --download-all ./artifacts
```

`artifacts` alone also accepts a job path/URL and selects its latest build.
Prefer a pinned build ref when downloading results of a specific operation.
Plain artifact paths always name jobs: `artifacts team/123` selects the latest
build of job `team/123`. Use `#number` or a build URL for a specific build.
Artifact filenames must be unique, or use the full relative path.

## Timeouts, errors and discovery

- `--request-timeout 30s`: one HTTP request, including the response body.
- `--wait-timeout 20m`: one total observation budget (default 10m).
- Durations accept `ms`, `s`, `m`, `h`; a bare number means milliseconds.
- Legacy `--timeout <integer-ms>` is HTTP-only; it never sets a wait budget.
  `--timeout 55s` is rejected; use `--wait-timeout 55s` to wait for a build.
- Legacy `--wait-timeout-ms <integer-ms>` remains supported.
- `--poll-ms <positive-integer>` controls polling (default 2000).
- `--check` on info/result/wait/watch/trigger-with-wait exits 9 for a non-SUCCESS
  or incomplete build. A completed failure retains `{ok:true,data:...}` because
  inspection succeeded; an incomplete checked build returns `BUILD_INCOMPLETE`.
- Exit codes: 0 success, 1 runtime, 2 usage, 3 config, 4 access/auth, 5 network,
  6 not found, 7 API, 8 timeout, 9 unsuccessful/incomplete build.
- Parse `error.code`, not English messages. Usage failures also obey `--json`.

Accepted refs: `queue:456`, queue/build URLs, `team/app#123`, `team/app/123`.
Multibranch job paths retain Jenkins encoding (`feature%2Fname`); URLs usually
contain `feature%252Fname`. Use returned refs/URLs instead of re-encoding them.

```bash
jenkins help build watch --json
jenkins help build logs --json
```

Structured help lists actual arguments, options and subcommands. Canonical
commands: `build ls`, `build info`, `build trigger`, `build watch`, `build logs`,
`wait`, `result`, `artifacts`, `jobs ls`, `jobs info`, `cfg`, `doctor`.
Aliases: `b` for build, `job` for jobs, `get`/`show` for info, `log` for logs,
`run` for trigger. `jenkins builds` is not a command.

## Setup

```bash
jenkins cfg set endpoint=https://jenkins.example.com username=alice
printf '%s' "$JENKINS_TOKEN" | jenkins cfg set api-token -
jenkins doctor --json
```

Config is resolved from global flags, environment, then
`~/.config/jenkins/config.json`. Supported env: `JENKINS_ENDPOINT`,
`JENKINS_USERNAME`, `JENKINS_API_TOKEN`, `JENKINS_TIMEOUT_MS`, `JENKINS_RETRIES`,
`JENKINS_REGION`. Never print tokens or pass them in argv.
