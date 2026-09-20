package postgres

import (
	"context"
	"fmt"

	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// ListPartTypes returns the fixed part-type catalog ordered by display_order.
// It is a plain read with no transaction: part_types is static reference
// data shared by all accounts, not per-account state.
func (s *Store) ListPartTypes(ctx context.Context) ([]domain.PartType, error) {
	rows, err := s.queries.ListPartTypes(ctx)
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
		})
	}
	return partTypes, nil
}
