package user

import (
	"context"
	"errors"
	"testing"
	"time"

	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

type timezoneDependencies struct {
	IPorts
	accountID, timezone string
	calls               int
	err                 error
}

func (d *timezoneDependencies) UpdateAccountTimezone(_ context.Context, id, zone string) (*domain.Account, error) {
	d.accountID, d.timezone = id, zone
	d.calls++
	if d.err != nil {
		return nil, d.err
	}
	return &domain.Account{ID: id, Email: "user@example.test", Timezone: zone}, nil
}

func TestUpdateTimezoneValidationAndPersistence(t *testing.T) {
	for _, zone := range []string{"UTC+00:00", "UTC+07:00", "UTC+05:30", "UTC+05:45", "UTC-03:30", "UTC-12:00", "UTC+14:00", "UTC-09:30", "UTC+08:45", "UTC+12:45", "UTC+13:45"} {
		t.Run(zone, func(t *testing.T) {
			deps := &timezoneDependencies{}
			account, err := NewService(deps, time.Hour).UpdateTimezone(context.Background(), "account", zone)
			want := zone
			if err != nil || account == nil || account.Timezone != want || deps.calls != 1 || deps.accountID != "account" || deps.timezone != want {
				t.Fatalf("update = %#v, %v; deps = %#v", account, err, deps)
			}
		})
	}
	for _, zone := range []string{"UTC-00:00", "UTC-12:01", "UTC+14:01", "UTC-13:00", "UTC+15:00", "UTC+07:60", "UTC+7:00", "UTC+07:0", "UTC+007:00", "UTC+07:000", "UTC+０７:00", "UTC−07:00", "UTC+07:00\n", " UTC+07:00", "UTC+07:00 ", "utc+07:00", "GMT+07:00", "GMTfoo", "UTC+07:00:00", "UTC++07:00", "UTC+aa:bb", "", "Local", "GMT", "EST", "+07:00", "Etc/UTC", "Etc/GMT-7", "Asia/Ho_Chi_Minh", "America/New_York", "UTC+05:17", "UTC+09:15"} {
		t.Run("invalid_"+zone, func(t *testing.T) {
			deps := &timezoneDependencies{}
			_, err := NewService(deps, time.Hour).UpdateTimezone(context.Background(), "account", zone)
			var appErr *app.Error
			if !errors.As(err, &appErr) || appErr.Code != app.ECValidationFailed || deps.calls != 0 {
				t.Fatalf("expected validation without persistence, got %v, calls=%d", err, deps.calls)
			}
		})
	}
}

func TestUpdateTimezoneFixedOffsetPresets(t *testing.T) {
	for offset := range supportedTimezoneOffsets {
		zone := formatOffset(offset)
		t.Run(zone, func(t *testing.T) {
			if !validTimezone(zone) {
				t.Fatalf("preset %s must be valid", zone)
			}
			deps := &timezoneDependencies{}
			account, err := NewService(deps, time.Hour).UpdateTimezone(context.Background(), "account", zone)
			want := zone
			if err != nil || account == nil || account.Timezone != want || deps.calls != 1 || deps.accountID != "account" || deps.timezone != want {
				t.Fatalf("update = %#v, %v; deps = %#v", account, err, deps)
			}
			location := time.FixedZone(zone, offset*60)
			for month := time.January; month <= time.December; month++ {
				date := time.Date(2026, month, 15, 12, 0, 0, 0, location)
				_, seconds := date.Zone()
				if seconds != offset*60 || date.IsDST() {
					t.Fatalf("%s in %s: offset=%d, DST=%v", zone, month, seconds, date.IsDST())
				}
			}
		})
	}
}

func TestUpdateTimezoneStoreErrors(t *testing.T) {
	for _, test := range []struct {
		err  error
		code string
	}{
		{ErrAccountNotFound, app.ECSessionExpired},
		{errors.New("private database details"), app.ECInternalError},
	} {
		_, err := NewService(&timezoneDependencies{err: test.err}, time.Hour).UpdateTimezone(context.Background(), "account", "UTC+00:00")
		var appErr *app.Error
		if !errors.As(err, &appErr) || appErr.Code != test.code || appErr.Message == test.err.Error() {
			t.Fatalf("expected sanitized %s, got %v", test.code, err)
		}
	}
}

func TestCanonicalOffsetNoDST(t *testing.T) {
	for _, test := range []struct {
		zone    string
		minutes int
	}{
		{"UTC+05:30", 330}, {"UTC+05:45", 345}, {"UTC-03:30", -210},
		{"UTC-12:00", -720}, {"UTC+14:00", 840}, {"UTC+07:00", 420}, {"UTC+00:00", 0},
	} {
		t.Run(test.zone, func(t *testing.T) {
			minutes, valid := canonicalOffsetMinutes(test.zone)
			if !valid || minutes != test.minutes {
				t.Fatalf("offset=(%d,%v), want %d", minutes, valid, test.minutes)
			}
			location := time.FixedZone(test.zone, minutes*60)
			for month := time.January; month <= time.December; month++ {
				date := time.Date(2026, month, 15, 12, 0, 0, 0, location)
				_, seconds := date.Zone()
				if seconds != test.minutes*60 || date.IsDST() {
					t.Fatalf("%s in %s: offset=%d DST=%v", test.zone, month, seconds, date.IsDST())
				}
			}
		})
	}
}
