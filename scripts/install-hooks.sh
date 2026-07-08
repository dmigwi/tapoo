#!/bin/bash
# Script to install git hooks for the project.
# Run this script to set up the pre-commit hook that enforces code quality.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SOURCE_HOOK="$REPO_ROOT/scripts/hooks/pre-commit"

echo "Installing git hooks..."

# Check if .git directory exists
if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "Error: .git directory not found. Are you in a git repository?"
    exit 1
fi

# Install pre-commit hook
if [ -f "$SOURCE_HOOK" ]; then
    cp "$SOURCE_HOOK" "$HOOKS_DIR/pre-commit"
    chmod +x "$HOOKS_DIR/pre-commit"
    echo "✅ Installed pre-commit hook"
else
    echo "❌ Error: $SOURCE_HOOK not found"
    exit 1
fi

# Check if golangci-lint is installed
if ! command -v golangci-lint &> /dev/null; then
    echo ""
    echo "⚠️  Warning: golangci-lint is not installed"
    echo "The pre-commit hook requires golangci-lint to be installed."
    echo ""
    echo "Install it using one of these methods:"
    echo "  - $ go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.12.2 "
    echo "  - macOS: brew install golangci-lint"
    echo "  - Linux: curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b \$(go env GOPATH)/bin"
    echo "  - Or visit: https://golangci-lint.run/welcome/install/"
    echo ""
fi

echo ""
echo "✅ Git hooks installed successfully!"
echo ""
echo "The pre-commit hook will now run golangci-lint before each commit."
echo "To bypass the hook (not recommended), use: git commit --no-verify"
