package redis

// Key schema for the Redis adapter. Keeping the prefixes centralized here
// means the Lua script in lua/create_token.lua (which hardcodes the
// "token:" prefix for the sibling key it deletes) stays the one place that
// must be kept in sync by hand.
const (
	sessionPrefix         = "session:"
	accountSessionsPrefix = "account_sessions:"
	tokenPrefix           = "token:"
	tokenIndexPrefix      = "token_index:"
	oauthStatePrefix      = "oauth_state:"
)

func sessionKey(sessionID string) string {
	return sessionPrefix + sessionID
}

func accountSessionsKey(accountID string) string {
	return accountSessionsPrefix + accountID
}

func tokenKey(kind, tokenHashHex string) string {
	return tokenPrefix + kind + ":" + tokenHashHex
}

func tokenIndexKey(kind, accountID string) string {
	return tokenIndexPrefix + kind + ":" + accountID
}

func oauthStateKey(state string) string {
	return oauthStatePrefix + state
}
