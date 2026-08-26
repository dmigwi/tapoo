.PHONY: help ci ci-bench lint govulncheck deps frontend-install frontend-deps frontend-typecheck frontend-lint frontend-test frontend-quality frontend-build frontend-local frontend-bench test go-bench agentic-analysis coverage clean-coverage

COVERAGE_FILE := coverage.out
GOCACHE := $(CURDIR)/.gocache
GOVULNCHECK_VERSION := v1.7.0
PNPM := pnpm

export GOCACHE

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make ci                Run the local equivalent of the CI pipeline.' \
		'  make ci-bench          Run Go and frontend benchmark suites.' \
		'  make lint              Run golangci-lint.' \
		'  make govulncheck       Run govulncheck against this module.' \
		'  make frontend-install  Install the pinned frontend toolchain.' \
		'  make frontend-quality  Run frontend typecheck, lint, and tests.' \
		'  make frontend-build    Build the browser frontend bundle.' \
		'  make frontend-local    Install, verify, and build the frontend locally.' \
		'  make test              Run frontend checks and Go tests with race + coverage.' \
		'  make agentic-analysis  Answer the agent rubric for exported gameplay logs.' \
		'                         Usage: make agentic-analysis LOGS="a.json b.json"' \
		'  make coverage          Print the coverage summary from coverage.out.' \
		'  make clean-coverage    Remove the generated coverage profile.'

ci: lint frontend-lint govulncheck test

ci-bench: frontend-deps
	node ./parity-harness/bench-report.mjs

lint:
	golangci-lint run

govulncheck:
	go run golang.org/x/vuln/cmd/govulncheck@$(GOVULNCHECK_VERSION) ./...

deps:
	go mod download
	go mod verify

frontend-deps:
	@test -x ./node_modules/.bin/tsc || \
		( echo "Frontend dependencies are missing. Run 'make frontend-install' first." >&2; exit 1 )
	@test -x ./node_modules/.bin/eslint || \
		( echo "Frontend dependencies are missing. Run 'make frontend-install' first." >&2; exit 1 )
	@test -x ./node_modules/.bin/vitest || \
		( echo "Frontend dependencies are missing. Run 'make frontend-install' first." >&2; exit 1 )
	@test -x ./node_modules/.bin/esbuild || \
		( echo "Frontend dependencies are missing. Run 'make frontend-install' first." >&2; exit 1 )

frontend-install:
	CI=true $(PNPM) install --frozen-lockfile --config.confirmModulesPurge=false

frontend-typecheck:
	./node_modules/.bin/tsc --project tsconfig.json --noEmit

frontend-lint:
	CI=true $(PNPM) --config.confirmModulesPurge=false run lint:frontend

frontend-test:
	CI=true $(PNPM) --config.confirmModulesPurge=false run test:frontend

frontend-bench: frontend-deps
	node ./parity-harness/bench-report.mjs --frontend-only

frontend-quality: frontend-deps
	CI=true $(PNPM) --config.confirmModulesPurge=false run quality:frontend

frontend-build:
	./scripts/build-frontend.sh

frontend-local: frontend-install frontend-quality frontend-build 

test: deps frontend-deps frontend-typecheck frontend-build frontend-test
	go test -race -covermode=atomic -coverprofile=$(COVERAGE_FILE) ./...
	rm -f $(COVERAGE_FILE)

go-bench:
	node ./parity-harness/bench-report.mjs --go-only

# Answers docs/TAPOO_AGENTIC_BEHAVIOR_RUBRIC.md against exported agent-api logs. Needs no frontend
# toolchain: the script only reads the JSON exports, so it runs before or without an install.
agentic-analysis:
	@test -n "$(LOGS)" || \
		( echo 'Set LOGS to one or more exported logs, e.g. make agentic-analysis LOGS="a.json b.json"' >&2; exit 1 )
	node ./scripts/agentic-analysis.mjs $(LOGS)

coverage:
	go tool cover -func=$(COVERAGE_FILE)

clean-coverage:
	rm -f $(COVERAGE_FILE)
