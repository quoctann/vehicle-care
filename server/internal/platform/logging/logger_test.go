package logging

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestJSONFileOutput(t *testing.T) {
	path := filepath.Join(t.TempDir(), "api.json")
	logger, err := NewWithFile("development", path)
	if err != nil {
		t.Fatal(err)
	}
	logger.Info("test event")
	_ = logger.Sync()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var record map[string]any
	if err := json.Unmarshal(b, &record); err != nil {
		t.Fatal(err)
	}
	if record["msg"] != "test event" || record["ts"] == nil {
		t.Fatalf("unexpected log: %s", b)
	}
}

func TestInvalidLogFile(t *testing.T) {
	if _, err := NewWithFile("production", filepath.Join(t.TempDir(), "missing", "api.json")); err == nil {
		t.Fatal("expected invalid output path error")
	}
}
