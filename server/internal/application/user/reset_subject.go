package user

import (
	"strconv"
	"strings"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// Reset token subjects bind issuance to the credential generation. Legacy
// subjects lacking a version are rejected rather than promoted to current.
func resetSubject(account domain.Account) string {
	return account.ID + ":" + strconv.FormatInt(account.AuthVersion, 10)
}

func parseResetSubject(subject string) (string, int64, bool) {
	id, value, ok := strings.Cut(subject, ":")
	version, err := strconv.ParseInt(value, 10, 64)
	return id, version, ok && id != "" && err == nil && version > 0
}
