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
printf '%s' "$JENKINS_TOKEN" | jenkins cfg set api-token -
jenkins doctor
```

Notes:

- Jenkins recommends API tokens for scripted clients instead of your real password.
- Requests authenticated with an API token are generally exempt from CSRF crumb requirements.
- Most Jenkins setups only show the raw token value once, so if you lose it, create a new one and revoke the old token.

## Auth and Config

The CLI resolves config in this order:

1. Environment variables
2. `~/.config/jenkins/config.json`

Supported env vars:

- `JENKINS_ENDPOINT`
- `JENKINS_USERNAME`
- `JENKINS_API_TOKEN`
- `JENKINS_TIMEOUT_MS`
- `JENKINS_RETRIES`
- `JENKINS_REGION`

Configure it with stdin-safe secret handling:

```bash
jenkins cfg set endpoint=https://jenkins.example.com username=alice
printf '%s' "$JENKINS_TOKEN" | jenkins cfg set api-token -
jenkins cfg ls
jenkins doctor
```

Export and import for machine setup:

```bash
jenkins cfg export --json
cat config.json | jenkins cfg import --json
```

## Common Commands

List jobs:

```bash
jenkins jobs ls
jenkins jobs ls team-folder --recursive
jenkins jobs info team-folder/app-build
jenkins jobs info team-folder/app-build --parameters
```

Inspect builds:

```bash
jenkins build ls team-folder/app-build --limit 5
jenkins build info team-folder/app-build#123
jenkins result team-folder/app-build#123
```

Trigger builds:

```bash
jenkins build trigger team-folder/app-build
jenkins build trigger team-folder/app-build \
  --param ENV=staging \
  --param VERSION=latest
jenkins build trigger team-folder/app-build \
  --params-json '{"ENV":"staging","VERSION":"latest"}' \
  --wait
jenkins build trigger team-folder/app-build \
  --param ENV=staging \
  --wait \
  --progress
```

Logs and waiting:

```bash
jenkins build logs team-folder/app-build#123
jenkins build logs queue:123 --follow
jenkins wait queue:123
jenkins wait queue:123 --progress
```

`jenkins jobs info --parameters` includes parameter definitions with name, type, default value, choices, and description when Jenkins exposes them.

`--progress` streams wait-state updates to stderr while keeping the final result on stdout. Queue waits show the current reason, started builds show the build number and URL, running builds show elapsed versus estimated time, and finished builds show the final result.

Accepted ref formats for `build info`, `build logs`, `wait`, and `result`:

- `queue:123`
- `https://jenkins.example.com/queue/item/123/`
- `team-folder/app-build#123`
- `https://jenkins.example.com/job/team-folder/job/app-build/123/`

## Output Modes

- default: human-readable summaries
- `--plain`: stable line-based output
- `--json`: single JSON object on stdout

## Skill

```bash
jenkins skill
```

This prints the skill install URL for `npx skills add`.
