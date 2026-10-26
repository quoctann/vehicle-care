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
	q := sqlcgen.New(tx)
	if err := q.LockGoogleSubject(ctx, subject); err != nil {
		return nil, err
	}
	id, err := q.GoogleAccountID(ctx, subject)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return s.AccountByID(ctx, id)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	a := domain.Account{ID: uuid.NewString(), Email: strings.ToLower(strings.TrimSpace(email)), Timezone: "UTC+07:00", EmailVerified: verified}
	if name != "" {
		a.Name = &name
	}
	if err := q.InsertAccount(ctx, sqlcgen.InsertAccountParams{ID: a.ID, Email: a.Email, Name: nullableString(a.Name), Timezone: a.Timezone, EmailVerified: verified}); err != nil {
		if isUniqueViolation(err, "accounts_email_unique") {
			return nil, user.ErrGoogleEmailExists
		}
		return nil, err
	}
	if err := q.CreateAccountSequence(ctx, a.ID); err != nil {
		return nil, err
	}
	if err := seed.SeedAccountPartTypes(ctx, q, a.ID, time.Now().UTC()); err != nil {
		return nil, err
	}
	if err := q.InsertGoogleIdentity(ctx, sqlcgen.InsertGoogleIdentityParams{AccountID: a.ID, Subject: subject}); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Store) LinkGoogle(ctx context.Context, accountID, subject string) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	q := sqlcgen.New(tx)
	if err := q.LockGoogleSubject(ctx, subject); err != nil {
		return err
	}
	err = q.InsertGoogleIdentity(ctx, sqlcgen.InsertGoogleIdentityParams{AccountID: accountID, Subject: subject})
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
