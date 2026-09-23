package migrations

import (
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestMigrationVersionsUseUnixSeconds(t *testing.T) {
	entries, err := FS.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".up.sql") {
			continue
		}
		version, _, ok := strings.Cut(entry.Name(), "_")
		n, err := strconv.ParseInt(version, 10, 64)
		if !ok || err != nil || n < 1_000_000_000 || n > time.Now().Unix() {
			t.Errorf("%s must use a past Unix-second version so migrate create produces a later version", entry.Name())
		}
		if _, err := FS.ReadFile(strings.TrimSuffix(entry.Name(), ".up.sql") + ".down.sql"); err != nil {
			t.Errorf("missing matching down migration for %s: %v", entry.Name(), err)
		}
	}
}
