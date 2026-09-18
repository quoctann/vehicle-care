package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/sqlcgen"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/ports"
)

const pgUniqueViolation = "23505"

// CreateAccount inserts the account and its account_sequences row (current
// current_seq = 0) in one transaction. The two rows must always exist
// together: NextSeq (used by ApplyMutations) locks and updates the
// account_sequences row and has nothing to lock if it is missing.
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
			return ports.ErrAccountExists
		}
		return fmt.Errorf("postgres: insert account: %w", err)
	}
	if err := queries.InsertAccountSequenceRow(ctx, account.ID); err != nil {
		return fmt.Errorf("postgres: insert account sequence row: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("postgres: commit create account: %w", err)
	}
	return nil
}

// AccountByEmail looks up an account using citext's built-in
// case-insensitive comparison.
//
// ports.AccountStore does not carry an error return here (the in-memory
// reference adapter never fails), so an unexpected database error is
// reported the same way as "not found": callers cannot tell the two apart
// through this method. That is an existing limitation of the interface,
// not something introduced by this adapter.
func (s *Store) AccountByEmail(ctx context.Context, email string) (domain.Account, bool) {
	row, err := s.queries.AccountByEmail(ctx, email)
	if err != nil {
		return domain.Account{}, false
	}
	return accountFromRow(row.ID, row.Email, row.Name, row.Timezone, row.EmailVerified, row.PasswordHash), true
}

// AccountByID looks up an account by primary key.
func (s *Store) AccountByID(ctx context.Context, id string) (domain.Account, bool) {
	row, err := s.queries.AccountByID(ctx, id)
	if err != nil {
		return domain.Account{}, false
	}
	return accountFromRow(row.ID, row.Email, row.Name, row.Timezone, row.EmailVerified, row.PasswordHash), true
}

// SetEmailVerified marks an account email as verified.
func (s *Store) SetEmailVerified(ctx context.Context, accountID string) error {
	if err := s.queries.SetEmailVerified(ctx, accountID); err != nil {
		return fmt.Errorf("postgres: set email verified: %w", err)
	}
	return nil
}

// SetPassword replaces an account password hash.
func (s *Store) SetPassword(ctx context.Context, accountID string, passwordHash []byte) error {
	if err := s.queries.SetPassword(ctx, sqlcgen.SetPasswordParams{ID: accountID, PasswordHash: passwordHash}); err != nil {
		return fmt.Errorf("postgres: set password: %w", err)
	}
	return nil
}

func accountFromRow(id, email string, name sql.NullString, timezone string, emailVerified bool, passwordHash []byte) domain.Account {
	account := domain.Account{
		ID:            id,
		Email:         email,
		Timezone:      timezone,
		EmailVerified: emailVerified,
		PasswordHash:  passwordHash,
	}
	if name.Valid {
		value := name.String
		account.Name = &value
	}
	return account
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
