package postgres

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/seed"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// The subject advisory lock serializes signup retries before account creation.
// Email uniqueness never authorizes linking an existing account.
func (s *Store) GoogleAccount(ctx context.Context, subject, email, name string, verified bool) (*domain.Account, error) {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	qtx := sqlcgen.New(tx)

	if err := qtx.LockGoogleSubject(ctx, subject); err != nil {
		return nil, err
	}

	id, err := qtx.GoogleAccountID(ctx, subject)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return s.AccountByID(ctx, id)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	acc := domain.Account{
		ID:            uuid.NewString(),
		Email:         strings.ToLower(strings.TrimSpace(email)),
		Timezone:      "UTC+07:00",
		EmailVerified: verified,
		AuthVersion:   1,
	}
	if name != "" {
		acc.Name = &name
	}

	if err := qtx.InsertAccount(ctx, sqlcgen.InsertAccountParams{
		ID:            acc.ID,
		Email:         acc.Email,
		Name:          nullableString(acc.Name),
		Timezone:      acc.Timezone,
		EmailVerified: verified},
	); err != nil {
		if isUniqueViolation(err, "accounts_email_unique") {
			return nil, user.ErrGoogleEmailExists
		}
		return nil, err
	}

	if err := qtx.CreateAccountSequence(ctx, acc.ID); err != nil {
		return nil, err
	}

	if err := seed.SeedAccountPartTypes(ctx, qtx, acc.ID, time.Now().UTC()); err != nil {
		return nil, err
	}

	if err := qtx.InsertGoogleIdentity(ctx, sqlcgen.InsertGoogleIdentityParams{AccountID: acc.ID, Subject: subject}); err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &acc, nil
}

func (s *Store) LinkGoogle(ctx context.Context, accountID, subject string, expectedAuthVersion int64) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	qtx := sqlcgen.New(tx)

	if err := qtx.LockGoogleSubject(ctx, subject); err != nil {
		return err
	}

	version, err := qtx.LockAccountAuthVersion(ctx, accountID)
	if errors.Is(err, sql.ErrNoRows) {
		return user.ErrAuthVersionChanged
	}
	if err != nil {
		return err
	}
	if expectedAuthVersion <= 0 || version != expectedAuthVersion {
		return user.ErrAuthVersionChanged
	}

	err = qtx.InsertGoogleIdentity(ctx, sqlcgen.InsertGoogleIdentityParams{AccountID: accountID, Subject: subject})
	if isUniqueViolation(err, "auth_identities_provider_subject_key") {
		return user.ErrGoogleIdentityLinked
	}
	if isUniqueViolation(err, "auth_identities_account_provider_key") {
		return user.ErrGoogleAlreadyLinked
	}
	if err != nil {
		return err
	}

	return tx.Commit()
}

func (s *Store) GoogleLinked(ctx context.Context, accountID string) (bool, error) {
	return s.queries.GoogleLinked(ctx, accountID)
}
