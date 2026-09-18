package redis

import (
	_ "embed"

	goredis "github.com/redis/go-redis/v9"
)

//go:embed lua/create_token.lua
var createTokenLua string

// createTokenScript supersedes a previous one-time token for the same
// (kind, accountID) and installs the new one. go-redis caches the script's
// SHA and transparently falls back from EVALSHA to EVAL on a cache miss.
var createTokenScript = goredis.NewScript(createTokenLua)
