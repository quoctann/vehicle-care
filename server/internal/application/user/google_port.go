package user

import (
	"context"
	"errors"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

var (
	ErrGoogleEmailExists    = errors.New("email_exists")
	ErrGoogleIdentityLinked = errors.New("identity_linked")
	ErrGoogleAlreadyLinked  = errors.New("already_linked")
)

const GoogleStateTTL = 10 * time.Minute

type GoogleState struct {
	AuthVersion int64
	Nonce       string
	Verifier    string
	Browser     string
	Purpose     string
	AccountID   string
	SessionID   string
}

type GoogleClaims struct {
	Subject, Email, Name string
	EmailTrusted         bool
}

type IGoogleProvider interface {
	AuthorizationURL(state, nonce, verifier string) string
	Verify(context.Context, string, string, string) (GoogleClaims, error)
}

type IGooglePorts interface {
	GoogleAccount(context.Context, string, string, string, bool) (*domain.Account, error)
	LinkGoogle(context.Context, string, string, int64) error
	GoogleLinked(context.Context, string) (bool, error)
	SaveGoogleState(context.Context, string, GoogleState, time.Duration) error
	TakeGoogleState(context.Context, string) (GoogleState, bool, error)
	AllowAuth(context.Context, string, int, time.Duration) (bool, error)
}
