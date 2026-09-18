// Package memory provides a process-local adapter for frontend integration.
package memory

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/ports"
)

type entitySnapshot struct {
	serverSeq  int64
	payload    map[string]any
	receivedAt time.Time
}

type storedChange struct {
	accountID string
	change    domain.Change
}

type tokenRecord struct {
	kind      string
	accountID string
	expiresAt time.Time
}

type watermarkRecord struct {
	upperBound int64
	expiresAt  time.Time
}

// Store is a thread-safe, process-local implementation of ports.Store.
type Store struct {
	mu                 sync.RWMutex
	accounts           map[string]domain.Account
	accountIDByEmail   map[string]string
	sessions           map[string]domain.Session
	tokens             map[string]tokenRecord
	devices            map[string]map[string]time.Time
	sequences          map[string]int64
	changes            []storedChange
	processedMutations map[string]domain.MutationResult
	latestEntities     map[string]entitySnapshot
	reminderScopes     map[string]string
	watermarks         map[string]map[string]watermarkRecord
}

// NewStore constructs an empty in-memory store.
func NewStore() *Store {
	return &Store{
		accounts:           make(map[string]domain.Account),
		accountIDByEmail:   make(map[string]string),
		sessions:           make(map[string]domain.Session),
		tokens:             make(map[string]tokenRecord),
		devices:            make(map[string]map[string]time.Time),
		sequences:          make(map[string]int64),
		processedMutations: make(map[string]domain.MutationResult),
		latestEntities:     make(map[string]entitySnapshot),
		reminderScopes:     make(map[string]string),
		watermarks:         make(map[string]map[string]watermarkRecord),
	}
}

// CreateAccount persists a unique account.
func (s *Store) CreateAccount(_ context.Context, account domain.Account) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	email := strings.ToLower(account.Email)
	if _, exists := s.accountIDByEmail[email]; exists {
		return ports.ErrAccountExists
	}
	s.accounts[account.ID] = cloneAccount(account)
	s.accountIDByEmail[email] = account.ID
	return nil
}

// AccountByEmail returns an account using a case-insensitive email lookup.
func (s *Store) AccountByEmail(_ context.Context, email string) (domain.Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	id, ok := s.accountIDByEmail[strings.ToLower(email)]
	if !ok {
		return domain.Account{}, false
	}
	account, ok := s.accounts[id]
	return cloneAccount(account), ok
}

// AccountByID returns an account by ID.
func (s *Store) AccountByID(_ context.Context, id string) (domain.Account, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	account, ok := s.accounts[id]
	return cloneAccount(account), ok
}

// SetEmailVerified marks an account email as verified.
func (s *Store) SetEmailVerified(_ context.Context, accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	account, ok := s.accounts[accountID]
	if !ok {
		return errors.New("account not found")
	}
	account.EmailVerified = true
	s.accounts[accountID] = account
	return nil
}

// SetPassword replaces an account password hash.
func (s *Store) SetPassword(_ context.Context, accountID string, passwordHash []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	account, ok := s.accounts[accountID]
	if !ok {
		return errors.New("account not found")
	}
	account.PasswordHash = append([]byte(nil), passwordHash...)
	s.accounts[accountID] = account
	return nil
}

// CreateToken stores a one-time auth token.
func (s *Store) CreateToken(_ context.Context, kind, token, accountID string, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, record := range s.tokens {
		if record.kind == kind && record.accountID == accountID {
			delete(s.tokens, key)
		}
	}
	s.tokens[tokenKey(token)] = tokenRecord{kind: kind, accountID: accountID, expiresAt: expiresAt}
	return nil
}

// ConsumeToken atomically retrieves and deletes a one-time token.
func (s *Store) ConsumeToken(_ context.Context, kind, token string, now time.Time) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := tokenKey(token)
	record, ok := s.tokens[key]
	if !ok || record.kind != kind || !now.Before(record.expiresAt) {
		if ok {
			delete(s.tokens, key)
		}
		return "", false, nil
	}
	delete(s.tokens, key)
	return record.accountID, true, nil
}

// RefreshSession extends an active session expiry.
func (s *Store) RefreshSession(_ context.Context, sessionID string, expiresAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[sessionID]
	if !ok {
		return errors.New("session not found")
	}
	session.ExpiresAt = expiresAt
	s.sessions[sessionID] = session
	return nil
}

// CreateSession stores a login session.
func (s *Store) CreateSession(_ context.Context, sessionID string, session domain.Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sessions[sessionID] = session
	return nil
}

// Session retrieves a non-expired login session.
func (s *Store) Session(_ context.Context, sessionID string, now time.Time) (domain.Session, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[sessionID]
	if !ok || !now.Before(session.ExpiresAt) {
		delete(s.sessions, sessionID)
		return domain.Session{}, false, nil
	}
	return session, true, nil
}

// GetAndRefreshSession retrieves a non-expired login session and slides its
// expiry in the same lock acquisition.
func (s *Store) GetAndRefreshSession(_ context.Context, sessionID string, now, newExpiresAt time.Time) (domain.Session, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session, ok := s.sessions[sessionID]
	if !ok || !now.Before(session.ExpiresAt) {
		delete(s.sessions, sessionID)
		return domain.Session{}, false, nil
	}
	session.ExpiresAt = newExpiresAt
	s.sessions[sessionID] = session
	return session, true, nil
}

// DeleteSession removes one login session.
func (s *Store) DeleteSession(_ context.Context, sessionID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.sessions, sessionID)
	return nil
}

// DeleteAccountSessions removes all sessions belonging to an account.
func (s *Store) DeleteAccountSessions(_ context.Context, accountID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for id, session := range s.sessions {
		if session.AccountID == accountID {
			delete(s.sessions, id)
		}
	}
	return nil
}

// RegisterDevice associates an installation with an account.
func (s *Store) RegisterDevice(_ context.Context, accountID, deviceID string) (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.devices[accountID]; !ok {
		s.devices[accountID] = make(map[string]time.Time)
	}
	if registeredAt, ok := s.devices[accountID][deviceID]; ok {
		return registeredAt, nil
	}
	registeredAt := time.Now().UTC()
	s.devices[accountID][deviceID] = registeredAt
	return registeredAt, nil
}

// DeviceRegistered reports whether a device belongs to an account.
func (s *Store) DeviceRegistered(_ context.Context, accountID, deviceID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.devices[accountID][deviceID]
	return ok
}

// EntityExists reports whether an entity snapshot belongs to an account.
func (s *Store) EntityExists(_ context.Context, accountID, entityType, entityID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.latestEntities[accountID+":"+entityType+":"+entityID]
	return ok
}

// ApplyMutations atomically deduplicates and appends a batch to the account changefeed.
func (s *Store) ApplyMutations(_ context.Context, accountID, deviceID string, mutations []domain.Mutation, now time.Time) []domain.MutationResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	results := make([]domain.MutationResult, 0, len(mutations))
	for index, mutation := range mutations {
		dedupeKey := accountID + ":" + deviceID + ":" + mutation.MutationID
		if existing, ok := s.processedMutations[dedupeKey]; ok {
			if existing.Status == "applied" || existing.Status == "conflict_resolved" {
				existing.Status = "duplicate"
			}
			results = append(results, cloneResult(existing))
			continue
		}

		entityKey := accountID + ":" + mutation.EntityType + ":" + mutation.EntityID
		current, hasCurrent := s.latestEntities[entityKey]
		if mutation.EntityType == "reminder_config" {
			scope := reminderScope(accountID, mutation.Payload)
			if mutation.Payload["deleted_at"] == nil {
				if existingID := s.reminderScopes[scope]; existingID != "" && existingID != mutation.EntityID {
					retryable := false
					result := domain.MutationResult{
						MutationID: mutation.MutationID, Status: "rejected", ErrorCode: "validation_failed",
						ErrorMessage: "An active reminder already exists for this vehicle and part type.", Retryable: &retryable,
					}
					s.processedMutations[dedupeKey] = result
					results = append(results, result)
					continue
				}
			}
		}
		if !isMutable(mutation.EntityType) && hasCurrent {
			result := domain.MutationResult{
				MutationID: mutation.MutationID, Status: "duplicate", ServerSeq: ptr(current.serverSeq), ReceivedAtServer: &current.receivedAt,
			}
			s.processedMutations[dedupeKey] = cloneResult(result)
			results = append(results, result)
			continue
		}
		s.sequences[accountID]++
		seq := s.sequences[accountID]
		receivedAt := now.Add(time.Duration(index) * time.Nanosecond).UTC()
		payload := cloneMap(mutation.Payload)
		status := "applied"
		if isMutable(mutation.EntityType) && hasCurrent && mutation.BaseServerSeq != nil && current.serverSeq > *mutation.BaseServerSeq {
			status = "conflict_resolved"
		}

		s.latestEntities[entityKey] = entitySnapshot{serverSeq: seq, payload: payload, receivedAt: receivedAt}
		if mutation.EntityType == "reminder_config" {
			if hasCurrent {
				oldScope := reminderScope(accountID, current.payload)
				if s.reminderScopes[oldScope] == mutation.EntityID {
					delete(s.reminderScopes, oldScope)
				}
			}
			if payload["deleted_at"] == nil {
				s.reminderScopes[reminderScope(accountID, payload)] = mutation.EntityID
			}
		}
		s.changes = append(s.changes, storedChange{accountID: accountID, change: domain.Change{
			ServerSeq: seq, EntityType: mutation.EntityType, EntityID: mutation.EntityID,
			Operation: mutation.Operation, Payload: cloneMap(payload), ReceivedAtServer: receivedAt,
		}})
		result := domain.MutationResult{
			MutationID: mutation.MutationID, Status: status, ServerSeq: ptr(seq), ReceivedAtServer: &receivedAt,
		}
		if status == "conflict_resolved" {
			result.ServerSnapshot = cloneMap(payload)
		}
		s.processedMutations[dedupeKey] = cloneResult(result)
		results = append(results, result)
	}
	return results
}

// Pull returns a page bounded by a watermark fixed at the first request.
func (s *Store) Pull(_ context.Context, accountID string, afterSeq int64, limit int, watermark string, now time.Time) (domain.PullPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for token, record := range s.watermarks[accountID] {
		if !now.Before(record.expiresAt) {
			delete(s.watermarks[accountID], token)
		}
	}
	if watermark == "" {
		watermark = "wm_" + uuid.NewString()
		if _, ok := s.watermarks[accountID]; !ok {
			s.watermarks[accountID] = make(map[string]watermarkRecord)
		}
		s.watermarks[accountID][watermark] = watermarkRecord{upperBound: s.sequences[accountID], expiresAt: now.Add(15 * time.Minute)}
	}
	record, ok := s.watermarks[accountID][watermark]
	if !ok {
		return domain.PullPage{}, errors.New("invalid watermark")
	}
	upperBound := record.upperBound

	changes := make([]domain.Change, 0, limit)
	hasMore := false
	for _, stored := range s.changes {
		if stored.accountID != accountID || stored.change.ServerSeq <= afterSeq || stored.change.ServerSeq > upperBound {
			continue
		}
		if len(changes) == limit {
			hasMore = true
			break
		}
		change := stored.change
		change.Payload = cloneMap(change.Payload)
		changes = append(changes, change)
	}
	nextCursor := afterSeq
	if len(changes) > 0 {
		nextCursor = changes[len(changes)-1].ServerSeq
	}
	return domain.PullPage{Changes: changes, NextCursor: nextCursor, Watermark: watermark, HasMore: hasMore}, nil
}

func cloneAccount(account domain.Account) domain.Account {
	account.PasswordHash = append([]byte(nil), account.PasswordHash...)
	return account
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func cloneResult(result domain.MutationResult) domain.MutationResult {
	result.ServerSnapshot = cloneMap(result.ServerSnapshot)
	return result
}

func isMutable(entityType string) bool {
	return entityType == "vehicle" || entityType == "reminder_config"
}

func ptr(value int64) *int64 { return &value }

func tokenKey(token string) string {
	return stringHash(sha256.Sum256([]byte(token)))
}

func stringHash(hash [sha256.Size]byte) string { return string(hash[:]) }

func reminderScope(accountID string, payload map[string]any) string {
	vehicleID, _ := payload["vehicle_id"].(string)
	partTypeID, _ := payload["part_type_id"].(string)
	return accountID + ":" + vehicleID + ":" + partTypeID
}
