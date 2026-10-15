package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
)

type accountDependencies struct {
	user.IPorts
	calls     int
	accountID string
}

func (d *accountDependencies) GetAndRefreshSession(_ context.Context, id string, _, _ time.Time) (*domain.Session, bool, error) {
	if id == "other-session" {
		return &domain.Session{AccountID: "other", CSRFToken: "csrf"}, true, nil
	}
	if id != "session" && id != "same-account-session" {
		return nil, false, nil
	}
	return &domain.Session{AccountID: "owner", CSRFToken: "csrf"}, true, nil
}

func (d *accountDependencies) AccountByID(_ context.Context, id string) (*domain.Account, error) {
	return &domain.Account{ID: id, Email: "owner@example.test", Timezone: "Asia/Ho_Chi_Minh"}, nil
}

func (d *accountDependencies) UpdateAccountTimezone(_ context.Context, id, zone string) (*domain.Account, error) {
	d.calls++
	d.accountID = id
	return &domain.Account{ID: id, Email: "owner@example.test", Timezone: zone, PasswordHash: []byte("secret")}, nil
}

func timezoneRequest(handler http.Handler, body, sid, cookie, header string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/account/timezone", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sid != "" {
		req.AddCookie(&http.Cookie{Name: "sid", Value: sid})
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "csrf_token", Value: cookie})
	}
	req.Header.Set("X-CSRF-Token", header)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, req)
	return recorder
}

func TestAccountTimezoneHTTP(t *testing.T) {
	for _, test := range []struct {
		name, body, sid, cookie, header string
		status                          int
	}{
		{"missing session", `{"timezone":"UTC"}`, "", "csrf", "csrf", 401},
		{"expired session", `{"timezone":"UTC"}`, "expired", "csrf", "csrf", 401},
		{"missing csrf", `{"timezone":"UTC"}`, "session", "", "", 403},
		{"wrong csrf header", `{"timezone":"UTC"}`, "session", "csrf", "wrong", 403},
		{"wrong csrf cookie", `{"timezone":"UTC"}`, "session", "wrong", "csrf", 403},
		{"invalid json", `{`, "session", "csrf", "csrf", 400},
		{"missing timezone", `{}`, "session", "csrf", "csrf", 400},
		{"wrong type", `{"timezone":7}`, "session", "csrf", "csrf", 400},
		{"local", `{"timezone":"Local"}`, "session", "csrf", "csrf", 400},
		{"IANA alias rejected", `{"timezone":"Etc/GMT-7"}`, "session", "csrf", "csrf", 400},
		{"IANA region rejected", `{"timezone":"Asia/Ho_Chi_Minh"}`, "session", "csrf", "csrf", 400},
		{"canonical preset", `{"timezone":"UTC+07:00"}`, "session", "csrf", "csrf", 200},
		{"canonical fractional", `{"timezone":"UTC+05:45"}`, "session", "csrf", "csrf", 200},
		{"canonical negative fractional", `{"timezone":"UTC-03:30"}`, "session", "csrf", "csrf", 200},
		{"canonical minimum", `{"timezone":"UTC-12:00"}`, "session", "csrf", "csrf", 200},
		{"canonical maximum", `{"timezone":"UTC+14:00"}`, "session", "csrf", "csrf", 200},
		{"canonical zero", `{"timezone":"UTC+00:00"}`, "session", "csrf", "csrf", 200},
		{"negative zero", `{"timezone":"UTC-00:00"}`, "session", "csrf", "csrf", 400},
		{"below minimum", `{"timezone":"UTC-12:01"}`, "session", "csrf", "csrf", 400},
		{"above maximum", `{"timezone":"UTC+14:01"}`, "session", "csrf", "csrf", 400},
		{"invalid minutes", `{"timezone":"UTC+07:60"}`, "session", "csrf", "csrf", 400},
		{"noncanonical hours", `{"timezone":"UTC+7:00"}`, "session", "csrf", "csrf", 400},
		{"offset whitespace", `{"timezone":"UTC+07:00 "}`, "session", "csrf", "csrf", 400},
		{"offset unicode", `{"timezone":"UTC+０７:00"}`, "session", "csrf", "csrf", 400},
		{"invalid GMT", `{"timezone":"GMTfoo"}`, "session", "csrf", "csrf", 400},
		{"invalid fixed offset", `{"timezone":"Etc/GMT-15"}`, "session", "csrf", "csrf", 400},
		{"matching expected account", `{"timezone":"UTC-05:00","expected_account_id":"owner"}`, "session", "csrf", "csrf", 200},
		{"stale tab account", `{"timezone":"UTC-05:00","expected_account_id":"owner"}`, "other-session", "csrf", "csrf", 409},
		{"empty expected account", `{"timezone":"UTC","expected_account_id":""}`, "session", "csrf", "csrf", 409},
		{"wrong expected account type", `{"timezone":"UTC","expected_account_id":7}`, "session", "csrf", "csrf", 400},
		{"success", `{"timezone":"UTC-05:00","account_id":"other"}`, "session", "csrf", "csrf", 200},
	} {
		t.Run(test.name, func(t *testing.T) {
			deps := &accountDependencies{}
			server := New(&Service{User: user.NewService(deps, time.Hour)}, config.Config{SessionTTL: time.Hour}, zap.NewNop())
			response := timezoneRequest(server.Handler(), test.body, test.sid, test.cookie, test.header)
			if response.Code != test.status {
				t.Fatalf("status=%d body=%s", response.Code, response.Body)
			}
			if test.status != 200 {
				if deps.calls != 0 {
					t.Fatal("rejected request persisted")
				}
				if test.status == 409 {
					var result struct {
						Error struct {
							Code      string `json:"code"`
							Message   string `json:"message"`
							Retryable bool   `json:"retryable"`
						} `json:"error"`
					}
					if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
						t.Fatal(err)
					}
					if result.Error.Code != "validation_failed" || result.Error.Retryable || result.Error.Message != "The session changed. Refresh and try again." {
						t.Fatalf("unsafe conflict response: %s", response.Body)
					}
				}
				return
			}
			var result struct {
				Account domain.Account `json:"account"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
			var request struct {
				Timezone string `json:"timezone"`
			}
			if err := json.Unmarshal([]byte(test.body), &request); err != nil {
				t.Fatal(err)
			}
			wantTimezone := request.Timezone
			if result.Account.ID != "owner" || result.Account.Timezone != wantTimezone || deps.accountID != "owner" || deps.calls != 1 || strings.Contains(response.Body.String(), "secret") {
				t.Fatalf("incorrect response/persistence: %s, %#v", response.Body, deps)
			}
		})
	}
}
