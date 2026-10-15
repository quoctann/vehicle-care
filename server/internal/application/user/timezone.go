package user

import (
	"context"
	"errors"
	"fmt"

	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

// Supported fixed offsets are intentionally kept in sync with the client's
// hardcoded timezone choices. Geographic names are presentation-only labels.
var supportedTimezoneOffsets = map[int]struct{}{
	-720: {}, -660: {}, -600: {}, -570: {}, -540: {}, -480: {}, -420: {}, -360: {}, -300: {}, -240: {},
	-210: {}, -180: {}, -120: {}, -60: {}, 0: {}, 60: {}, 120: {}, 180: {}, 210: {}, 240: {}, 270: {},
	300: {}, 330: {}, 345: {}, 360: {}, 390: {}, 420: {}, 480: {}, 525: {}, 540: {}, 570: {}, 600: {},
	630: {}, 660: {}, 720: {}, 765: {}, 780: {}, 825: {}, 840: {},
}

func (s *Service) UpdateTimezone(ctx context.Context, accountID, timezone string) (*domain.Account, error) {
	minutes, valid := canonicalOffsetMinutes(timezone)
	if !valid {
		return nil, validation("timezone must be a supported fixed UTC offset.")
	}
	account, err := s.ports.UpdateAccountTimezone(ctx, accountID, formatOffset(minutes))
	if errors.Is(err, ErrAccountNotFound) {
		return nil, &app.Error{Code: app.ECSessionExpired, Message: "Session expired or missing."}
	}
	if err != nil || account == nil {
		return nil, &app.Error{Code: app.ECInternalError, Message: "Account store is unavailable."}
	}
	return account, nil
}

func validTimezone(value string) bool {
	_, valid := canonicalOffsetMinutes(value)
	return valid
}

func canonicalOffsetMinutes(value string) (int, bool) {
	if len(value) != 9 || value[:3] != "UTC" || (value[3] != '+' && value[3] != '-') || value[6] != ':' {
		return 0, false
	}
	for _, index := range []int{4, 5, 7, 8} {
		if value[index] < '0' || value[index] > '9' {
			return 0, false
		}
	}
	hours := int(value[4]-'0')*10 + int(value[5]-'0')
	minutes := int(value[7]-'0')*10 + int(value[8]-'0')
	if minutes > 59 {
		return 0, false
	}
	offset := hours*60 + minutes
	if value[3] == '-' {
		offset = -offset
	}
	_, supported := supportedTimezoneOffsets[offset]
	return offset, supported && !(value[3] == '-' && offset == 0)
}

func formatOffset(minutes int) string {
	sign := "+"
	if minutes < 0 {
		sign, minutes = "-", -minutes
	}
	return fmt.Sprintf("UTC%s%02d:%02d", sign, minutes/60, minutes%60)
}
