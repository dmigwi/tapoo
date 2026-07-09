.PHONY: help ci lint govulncheck deps frontend-install frontend-deps frontend-typecheck frontend-build test coverage clean-coverage

COVERAGE_FILE := coverage.out
GOCACHE := $(CURDIR)/.gocache
GOVULNCHECK_VERSION := v1.5.0
PNPM := pnpm

export GOCACHE

help:
	@printf '%s\n' \
		'Available targets:' \
		'  make ci                Run the local equivalent of the CI pipeline.' \
		'  make lint              Run golangci-lint.' \
		'  make govulncheck       Run govulncheck against this module.' \
		'  make frontend-install  Install the pinned frontend toolchain.' \
		'  make test              Run frontend checks and Go tests with race + coverage.' \
		'  make coverage          Print the coverage summary from coverage.out.' \
		'  make clean-coverage    Remove the generated coverage profile.'

ci: lint govulncheck test

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
	@test -x ./node_modules/.bin/esbuild || \
		( echo "Frontend dependencies are missing. Run 'make frontend-install' first." >&2; exit 1 )

frontend-install:
	CI=true $(PNPM) install --frozen-lockfile --config.confirmModulesPurge=false

frontend-typecheck:
	./node_modules/.bin/tsc --project tsconfig.json --noEmit

frontend-build:
	./scripts/build-frontend.sh

test: deps frontend-deps frontend-typecheck frontend-build
	go test -race -covermode=atomic -coverprofile=$(COVERAGE_FILE) ./...

coverage:
	go tool cover -func=$(COVERAGE_FILE)

clean-coverage:
	rm -f $(COVERAGE_FILE)
