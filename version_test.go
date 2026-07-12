package main

import (
	"regexp"
	"testing"
)

func TestAppVersionUsesSemanticVersioning(t *testing.T) {
	t.Parallel()

	semverPattern := regexp.MustCompile(`^v\d+\.\d+\.\d+$`)
	if !semverPattern.MatchString(appVersion()) {
		t.Fatalf("expected semantic version, got %q", appVersion())
	}
}
