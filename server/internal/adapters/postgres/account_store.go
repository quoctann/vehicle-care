package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/seed"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	app_user "github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

const pgUniqueViolation = "23505"

func (s *Store) CreateAccount(ctx context.Context, account domain.Account) error {
	tx, err := s.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("postgres: begin create account: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	queries := sqlcgen.New(tx)

	if err := queries.InsertAccount(ctx, sqlcgen.InsertAccountParams{
		ID:            account.ID,
		Email:         account.Email,
		Name:          nullableString(account.Name),
		Timezone:      account.Timezone,
		EmailVerified: account.EmailVerified,
		PasswordHash:  account.PasswordHash,
	}); err != nil {
		if isUniqueViolation(err, "accounts_email_unique") {
			return app_user.ErrAccountExists
		}
		return fmt.Errorf("postgres: insert account: %w", err)
	}

	if err := queries.CreateAccountSequence(ctx, account.ID); err != nil {
		return fmt.Errorf("postgres: create account sequence: %w", err)
	}

	if err := seed.SeedAccountPartTypes(ctx, queries, account.ID, time.Now().UTC()); err != nil {
		return fmt.Errorf("postgres: seed account part types: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("postgres: commit create account: %w", err)
	}

	return nil
}

func (s *Store) AccountByEmail(ctx context.Context, email string) (*domain.Account, error) {
	row, err := s.queries.AccountByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, app_user.ErrAccountNotFound
		}
		return nil, fmt.Errorf("postgres: find account by email: %w", err)
	}

	account := domain.Account{
		ID:            row.ID,
		Email:         row.Email,
		Timezone:      row.Timezone,
		EmailVerified: row.EmailVerified,
		PasswordHash:  row.PasswordHash,
	}
	if row.Name.Valid {
		value := row.Name.String
		account.Name = &value
	}

	return &account, nil
}

func (s *Store) AccountByID(ctx context.Context, id string) (*domain.Account, error) {
	row, err := s.queries.AccountByID(ctx, id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, app_user.ErrAccountNotFound
		}
		return nil, fmt.Errorf("postgres: find account by id: %w", err)
	}

	account := domain.Account{
		ID:            row.ID,
		Email:         row.Email,
		Timezone:      row.Timezone,
		EmailVerified: row.EmailVerified,
		PasswordHash:  row.PasswordHash,
	}
	if row.Name.Valid {
		value := row.Name.String
		account.Name = &value
	}

	return &account, nil
}

func (s *Store) SetEmailVerified(ctx context.Context, accountID string) error {
	if err := s.queries.SetEmailVerified(ctx, accountID); err != nil {
		return fmt.Errorf("postgres: set email verified: %w", err)
	}
	return nil
}

func (s *Store) SetPassword(ctx context.Context, accountID string, passwordHash []byte) error {
	if err := s.queries.SetPassword(ctx, sqlcgen.SetPasswordParams{ID: accountID, PasswordHash: passwordHash}); err != nil {
		return fmt.Errorf("postgres: set password: %w", err)
	}
	return nil
}

func nullableString(value *string) sql.NullString {
	if value == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *value, Valid: true}
}

// isUniqueViolation reports whether err is a PostgreSQL unique_violation
// (SQLSTATE 23505), optionally scoped to a specific constraint name.
func isUniqueViolation(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != pgUniqueViolation {
		return false
	}
	return constraint == "" || pgErr.ConstraintName == constraint
}
