package datasync

import (
	"context"
	"time"

	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type Service struct {
	deps       IDependencies
	batchLimit int
	pageLimit  int
	now        func() time.Time
}

func NewService(deps IDependencies, batchLimit, pageLimit int) *Service {
	return &Service{deps: deps, batchLimit: batchLimit, pageLimit: pageLimit, now: time.Now}
}

// Push applies one mutation at a time in request order. A terminal or
// retryable result stops the batch so later mutations retain FIFO order.
func (s *Service) Push(ctx context.Context, accountID, deviceID, apiVersion string, mutations []domain.Mutation) ([]domain.MutationResult, error) {
	if apiVersion != "1" {
		return nil, &app.Error{Code: "unsupported_version", Message: "Unsupported API version."}
	}
	registered, err := s.deps.DeviceRegistered(ctx, accountID, deviceID)
	if err != nil {
		return nil, err
	}
	if !registered {
		return nil, &app.Error{Code: "ownership_invalid", Message: "Device is not registered to this account."}
	}
	if len(mutations) > s.batchLimit {
		return nil, validation("Mutation batch exceeds the configured limit.")
	}
	results := make([]domain.MutationResult, 0, len(mutations))
	for _, mutation := range mutations {
		if code, message := validateMutation(mutation); message != "" {
			results = append(results, rejected(mutation.MutationID, code, message))
			break
		}
		applied := s.deps.ApplyMutations(ctx, accountID, deviceID, []domain.Mutation{mutation}, s.now())
		if len(applied) == 0 {
			results = append(results, retryableErrorResult(mutation.MutationID, "Mutation was not processed."))
			break
		}
		result := applied[0]
		results = append(results, result)
		if result.Status == "rejected" || result.Status == "retryable_error" {
			break
		}
	}
	return results, nil
}

// Pull reads one page bounded by a stateless upper sequence.
func (s *Service) Pull(ctx context.Context, accountID string, afterSeq int64, limit int, untilSeq *int64) (domain.PullPage, error) {
	if afterSeq < 0 || limit < 1 {
		return domain.PullPage{}, validation("after_seq and limit are invalid.")
	}
	if untilSeq != nil && (*untilSeq < 0 || *untilSeq < afterSeq) {
		return domain.PullPage{}, validation("until_seq is invalid.")
	}
	if limit > s.pageLimit {
		limit = s.pageLimit
	}
	page, err := s.deps.Pull(ctx, accountID, afterSeq, limit, untilSeq)
	if err != nil {
		return domain.PullPage{}, err
	}
	return page, nil
}

// ListPartTypes returns the catalog owned by accountID.
func (s *Service) ListPartTypes(ctx context.Context, accountID string) ([]domain.PartType, error) {
	return s.deps.ListPartTypes(ctx, accountID)
}

func rejected(mutationID, code, message string) domain.MutationResult {
	retryable := false
	return domain.MutationResult{MutationID: mutationID, Status: "rejected", ErrorCode: code, ErrorMessage: message, Retryable: &retryable}
}

func retryableErrorResult(mutationID, message string) domain.MutationResult {
	retryable := true
	return domain.MutationResult{MutationID: mutationID, Status: "retryable_error", ErrorCode: "internal_error", ErrorMessage: message, Retryable: &retryable}
}

func validation(message string) error {
	return &app.Error{Code: "validation_failed", Message: message}
}
