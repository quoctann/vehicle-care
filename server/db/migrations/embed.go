// Package migrations embeds the SQL migration files so they ship inside the
// compiled binary instead of depending on a filesystem path at runtime.
package migrations

import "embed"

// FS holds every migration file in this directory.
//
//go:embed *.sql
var FS embed.FS
