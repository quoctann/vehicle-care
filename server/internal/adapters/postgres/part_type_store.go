package postgres

import (
	"context"
	"fmt"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// ListPartTypes returns the global part-type catalog plus accountID's own
// custom rows. It is a plain read with no transaction.
func (s *Store) ListPartTypes(ctx context.Context, accountID string) ([]domain.PartType, error) {
	rows, err := s.queries.ListPartTypes(ctx, &accountID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list part types: %w", err)
	}
	partTypes := make([]domain.PartType, 0, len(rows))
	for _, row := range rows {
		partTypes = append(partTypes, domain.PartType{
			ID:           row.ID,
			Code:         row.Code,
			NameVI:       row.NameVi,
			DisplayOrder: row.DisplayOrder,
			Active:       row.Active,
			SeedVersion:  row.SeedVersion,
			AccountID:    row.AccountID,
		})
	}
	return partTypes, nil
}
