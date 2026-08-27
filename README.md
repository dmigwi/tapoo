# Tapoo
[![TypeScript Version](https://img.shields.io/badge/TypeScript-6.0.3+-blue.svg)](http://www.typescriptlang.org/)
[![Go Version](https://img.shields.io/badge/go-1.25+-00ADD8.svg)](https://go.dev/)
[![Go CI](https://github.com/dmigwi/tapoo/actions/workflows/go.yml/badge.svg)](https://github.com/dmigwi/tapoo/actions/workflows/go.yml)
[![Page Deployment](https://github.com/dmigwi/tapoo/actions/workflows/pages.yml/badge.svg)](https://github.com/dmigwi/tapoo/actions/workflows/pages.yml)

Tapoo is a maze runner hide-and-seek game with two interfaces built from the same codebase: a Go terminal game and a browser SPA with the same terminal-inspired feel.

**Objective:** _Guide the blue player to the red destination before the score drops to zero._

## Quick Start

### Terminal

```bash
go install github.com/dmigwi/tapoo@latest
tapoo
```

### Run from source

```bash
go run .
```

### Browser

```bash
make frontend-install
make frontend-build
```

Then serve `public/` and open `/index.html`.

<details>
<summary><strong>Gameplay Preview</strong></summary>

<img alt="tapoo-gameplay" src="https://github.com/user-attachments/assets/e5596ea7-7ac1-41cc-a2b7-54cf862ff10e" width="720" style="max-width: 100%; height: auto;" />

</details>

<details>
<summary><strong>Gameplay And Controls</strong></summary>

Tapoo increases maze area as levels rise. Progress continues until the current terminal window or browser viewport can no longer fit the next maze cleanly.

### Terminal controls

- `Arrow keys`: move the player
- `Ctrl+B`: cycle maze wall weight
- `Space` or `Esc`: pause the current run
- `Enter`: proceed after pause, win, or failure
- `Ctrl+C`: quit

### Browser controls

- Keyboard controls mirror the terminal controls
- `Ctrl+Alt+R`: reset browser progress
- On touch devices, on-screen controls are shown automatically

</details>

<details>
<summary><strong>Highlights</strong></summary>

- Terminal-first maze gameplay
- Browser SPA with the same black-and-green terminal feel
- Adjustable wall weights with live cycling during play
- Per-level scoring and progression
- Pause, resume, retry, and next-level flow
- HTTP-driven AI agent play against Ollama, OpenAI-compatible, and Anthropic APIs, with up to 6 (configurable) agent seats
- Best-effort persistence for terminal and browser sessions
- Manual GitHub Pages deployment for the web build
- Go and TypeScript test coverage in CI

</details>

<details>
<summary><strong>Browser App</strong></summary>

The browser build emits versioned JS/CSS bundles under [public/js](/Users/dmigwi/theSecretCoder/App/Golang/src/github.com/dmigwi/tapoo/public/js) and [public/css](/Users/dmigwi/theSecretCoder/App/Golang/src/github.com/dmigwi/tapoo/public/css), then serves the SPA from [public/index.html](/Users/dmigwi/theSecretCoder/App/Golang/src/github.com/dmigwi/tapoo/public/index.html).

This compiles [frontend/tapoo.ts](/frontend/tapoo.ts) with `esbuild` into a minified browser bundle.

Available pages:

- `/index.html` for the game
- `/agents.html` for configuring and running HTTP-driven AI agents
- `/prompts.html` for previewing the exact prompts and tool definitions sent to an agent
- `/privacy.html` for the browser storage and agent data privacy notice

</details>

<details>
<summary><strong>AI Agents</strong></summary>

Instead of (or alongside) a human player, up to 6 agent seats can each be configured to play the maze by calling an HTTP chat-completions endpoint every turn.

### Supported providers

- **Ollama** - native `/api/chat` shape
- **OpenAI-compatible** - `/v1/chat/completions` (also covers self-hosted servers such as vLLM, LM Studio, and llama.cpp, and routers such as Hugging Face's Inference Providers)
- **Anthropic** - `/v1/messages`

### Per-agent configuration

Each seat is configured independently from the `/agents.html` overlay:

- player name, model, endpoint, and API provider
- credential (bearer token or API key) and custom extra headers, e.g. `anthropic-version`
- **reasoning effort** - how hard the model reasons before replying; the available levels and default depend on the provider, since reasoning support varies by model (e.g. Kimi K3 handles heavy reasoning well, Gemma 4 does not)
- **echo back reasoning** - whether prior reasoning content is replayed on the next request, off by default since guidance on this conflicts across reasoning models; locked off automatically whenever reasoning effort is set to `none`, and has no effect for Anthropic agents

The `/prompts.html` page mirrors the exact system prompt, tool definitions, and required response format an agent receives, so its behavior can be inspected without capturing live traffic.

</details>

<details>
<summary><strong>Persistence</strong></summary>

Tapoo carries a semantic version (`MAJOR.MINOR.PATCH`), shown in the terminal intro banner and in the browser footer. Browser storage additionally carries its own separate schema version, independent of the app version above - see the browser storage note below.

### Terminal

The terminal version stores best-effort runtime state in a local file:

- `.tapoo.store`

It keeps track of:

- current level
- selected wall weight
- last game progress state

If the persisted state cannot be read or validated, Tapoo falls back to default startup behavior.

### Browser

The SPA stores gameplay state in browser storage:

- `localStorage` for durable preferences such as level and wall weight, and for configured agent seats (including credentials, endpoints, and per-agent reasoning settings)
- `sessionStorage` for the active round snapshot

Every stored entry is tagged with the current storage schema version. On startup, Tapoo automatically discards any entries left over from an older schema version rather than attempting to migrate them - so upgrading Tapoo can silently reset previously stored preferences and agent configuration.

Privacy note: browser storage stays on the current device unless the user clears it, resets progress, or removes configured agent data. Browser storage is lightly obfuscated to discourage casual tampering, but it should not be treated as strong encryption for personal data. When AI Agent play is configured, gameplay context such as player name, current cell, destination cell, submitted moves, score, level, and traversal history may be sent to the configured agent API endpoint.

The deployed browser pages include a short privacy notice at `privacy.html`.

</details>

<details>
<summary><strong>Development</strong></summary>

### Requirements

- Go `1.25+`
- `pnpm 11.7.0`
- Node.js `22`
- `golangci-lint v2.12.2`

### Useful commands

```bash
make help
make frontend-install
make frontend-quality
make frontend-build
make test
make ci
```

### Benchmarks

Go and TypeScript carve mazes independently from different random sources, so [parity-harness/bench-report.mjs](/parity-harness/bench-report.mjs) runs both ports' benchmark suites ([maze/bench](/maze/bench) and [frontend/bench](/frontend/bench)) and checks that the two generators produce identical per-sample maze structures rather than merely eyeballing the numbers. A flagged case means a reproducible behavioral gap between the ports, not just run-to-run noise.

```bash
make go-bench        # Go maze generation only
make frontend-bench  # TypeScript maze generation only
make ci-bench        # both, with the cross-port parity check
```

Each run also writes `parity-harness/bench-report.json` with the full comparison and SVG charts.

</details>

<details>
<summary><strong>Contributing</strong></summary>

Contributions are welcome, but contributors should install the repository pre-commit hook before creating commits.

### Contributor setup

1. Install the required toolchains:
   `Go 1.25+`, `Node.js 22`, `pnpm 11.7.0`, and `golangci-lint v2.12.2`
2. Install frontend dependencies:

```bash
make frontend-install
```

3. Install the repository git hooks:

```bash
./scripts/install-hooks.sh
```

The hook installer copies [scripts/hooks/pre-commit](/scripts/hooks/pre-commit) into `.git/hooks/pre-commit`.

### Why the hook matters

The pre-commit hook runs:

```bash
golangci-lint run
```

This is required so commits are checked locally before they are pushed. If `golangci-lint` is not installed, the hook installation script will warn you and show installation options.

### Recommended checks before opening a PR

```bash
make ci
```

At minimum, contributors should make sure:

- Go tests pass
- frontend typecheck, lint, and tests pass
- `golangci-lint run` passes
- `govulncheck` passes

### Make targets

- `make lint`: run `golangci-lint`
- `make govulncheck`: run `govulncheck`
- `make frontend-quality`: run frontend typecheck, lint, and tests
- `make frontend-build`: build the minified SPA bundle
- `make test`: run frontend checks plus Go race tests with coverage
- `make ci`: run the local equivalent of the main CI pipeline

</details>

<details>
<summary><strong>Testing And Quality</strong></summary>

### Go

```bash
go test ./...
go test -race -covermode=atomic -coverprofile=coverage.out ./...
golangci-lint run
```

### Frontend

```bash
pnpm run typecheck:frontend
pnpm run lint:frontend
pnpm run test:frontend
pnpm run coverage:frontend
```

</details>

<details>
<summary><strong>CI And Deployment</strong></summary>

### Continuous Integration

The main CI workflow lives at [`.github/workflows/go.yml`](/.github/workflows/go.yml) and runs:

- Go linting
- `govulncheck`
- frontend typecheck, lint, tests, and build
- Go race tests with coverage
- coverage uploads for Go and frontend reports

### GitHub Pages

The Pages workflow lives at [`.github/workflows/pages.yml`](/.github/workflows/pages.yml).

Pages deployment is manual-only.

To deploy:

1. Open the repository on GitHub.
2. Go to `Actions`.
3. Choose `Deploy Pages Manually`.
4. Click `Run workflow`.
5. Select the branch you want to deploy.

Important:

- GitHub Pages should be configured to use `GitHub Actions` as the publishing source.
- Since the workflow is manual, it deploys the branch selected at run time.

</details>

## Project Layout

```text
maze/          Go gameplay, rendering, persistence, and tests
frontend/app/  TypeScript SPA logic and tests
public/        Static site assets, HTML, CSS, images, and built JS
scripts/       Frontend build and hook helpers
```

## License

This project is licensed under the Apache License 2.0. See [LICENSE](/LICENSE).
Tapoo is distributed on an `AS IS` basis, without warranties or guaranteed support.
