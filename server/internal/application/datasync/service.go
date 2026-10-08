package datasync

import (
	"context"
	"time"

	"github.com/google/uuid"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type Service struct {
	ports      IPorts
	batchLimit int
	pageLimit  int
	now        func() time.Time
}

func NewService(ports IPorts, batchLimit, pageLimit int) *Service {
	return &Service{ports: ports, batchLimit: batchLimit, pageLimit: pageLimit, now: time.Now}
}

// Push applies one mutation at a time in request order. A terminal or
// retryable result stops the batch so later mutations retain FIFO order.
func (s *Service) Push(ctx context.Context, accountID string, deviceID string, mutations []domain.Mutation) ([]domain.MutationResult, error) {
	if len(mutations) > s.batchLimit {
		return nil, validation("Mutation batch exceeds the limit.")
	}
	if _, err := uuid.Parse(deviceID); err != nil {
		return nil, validation("device_id must be a UUID.")
	}

	registered, err := s.ports.DeviceRegistered(ctx, accountID, deviceID)
	if err != nil {
		return nil, err
	}
	if !registered {
		return nil, &app.Error{Code: app.ECOwnershipInvalid, Message: "Device is not registered to this account."}
	}

	results := make([]domain.MutationResult, 0, len(mutations))
	for _, mutation := range mutations {
		if code, message := validateMutation(mutation); message != "" {
			results = append(results, rejected(mutation.MutationID, code, message))
			break
		}

		result := s.ports.ApplyMutation(ctx, accountID, deviceID, mutation, s.now())
		if result == nil {
			retryable := true
			results = append(results, domain.MutationResult{MutationID: mutation.MutationID, Status: domain.StatusRetryableError, ErrorCode: domain.MutationErrorInternal, ErrorMessage: "Temporary storage failure. Please retry.", Retryable: &retryable})
			break
		}
		results = append(results, *result)
		if result.Status == domain.StatusRejected || result.Status == domain.StatusRetryableError {
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

	page, err := s.ports.Pull(ctx, accountID, afterSeq, limit, untilSeq)
	if err != nil {
		return domain.PullPage{}, err
	}
	if page == nil {
		return domain.PullPage{}, &app.Error{Code: app.ECInternalError, Message: "Pull store returned no page."}
	}

	return *page, nil
}

func (s *Service) ListPartTypes(ctx context.Context, accountID string) ([]domain.PartType, error) {
	partTypes, err := s.ports.ListPartTypes(ctx, accountID)
	if err != nil {
		return nil, err
	}
	values := make([]domain.PartType, 0, len(partTypes))
	for _, partType := range partTypes {
		if partType == nil {
			return nil, &app.Error{Code: app.ECInternalError, Message: "Part type store returned an invalid entry."}
		}
		values = append(values, *partType)
	}
	return values, nil
}

func rejected(mutationID string, code domain.MutationErrorCode, message string) domain.MutationResult {
	retryable := false
	return domain.MutationResult{MutationID: mutationID, Status: domain.StatusRejected, ErrorCode: code, ErrorMessage: message, Retryable: &retryable}
}

func validation(message string) error {
	return &app.Error{Code: app.ECValidationFailed, Message: message}
}
