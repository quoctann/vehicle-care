package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/datasync"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
)

const (
	syncAccountA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	syncAccountB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	syncDevice   = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
)

type syncUserDependencies struct {
	user.IPorts
	registerCalls int
	accountID     string
}

func (d *syncUserDependencies) GetAndRefreshSession(_ context.Context, id string, _, _ time.Time) (*domain.Session, bool, error) {
	accountID := syncAccountA
	if id == "session-b" {
		accountID = syncAccountB
	} else if id != "session-a" {
		return nil, false, nil
	}
	return &domain.Session{AccountID: accountID, CSRFToken: "csrf", AuthVersion: 1}, true, nil
}

func (d *syncUserDependencies) AccountByID(_ context.Context, id string) (*domain.Account, error) {
	return &domain.Account{ID: id, Email: "sync@example.test", Timezone: "UTC+07:00", AuthVersion: 1}, nil
}

func (d *syncUserDependencies) RegisterDevice(_ context.Context, accountID, _ string) (time.Time, error) {
	d.registerCalls++
	d.accountID = accountID
	return time.Date(2026, 10, 25, 0, 0, 0, 0, time.UTC), nil
}

type syncDataDependencies struct {
	datasync.IPorts
	deviceCalls, mutationCalls, pullCalls int
	accountID                             string
}

func (d *syncDataDependencies) DeviceRegistered(_ context.Context, accountID, _ string) (bool, error) {
	d.deviceCalls++
	d.accountID = accountID
	// The same device is already registered under B: this must not bypass the precondition.
	return true, nil
}

func (d *syncDataDependencies) ApplyMutation(_ context.Context, accountID, _ string, mutation domain.Mutation, _ time.Time) *domain.MutationResult {
	d.mutationCalls++
	d.accountID = accountID
	return &domain.MutationResult{MutationID: mutation.MutationID, Status: domain.StatusApplied}
}

func (d *syncDataDependencies) Pull(_ context.Context, accountID string, _ int64, _ int, _ *int64) (*domain.PullPage, error) {
	d.pullCalls++
	d.accountID = accountID
	return &domain.PullPage{}, nil
}

func syncHTTPRequest(handler http.Handler, endpoint, expected, sid, cookie, header string) *httptest.ResponseRecorder {
	method, path, body := http.MethodPost, "/"+endpoint, ""
	if endpoint == "sync/pull" {
		method = http.MethodGet
		if expected != "missing" {
			path += "?expected_account_id=" + expected
		}
	} else {
		field := ""
		if expected != "missing" {
			field = fmt.Sprintf(`,"expected_account_id":%q`, expected)
		}
		if endpoint == "devices/register" {
			body = fmt.Sprintf(`{"device_id":%q,"platform":"web","app_version":"test"%s}`, syncDevice, field)
		} else {
			// A fresh vehicle has no ownership references that could independently reject the request.
			body = fmt.Sprintf(`{"device_id":%q,"mutations":[{"mutation_id":"11111111-1111-4111-8111-111111111111","entity_type":"vehicle","operation":"create","entity_id":"22222222-2222-4222-8222-222222222222","payload":{"name":"New vehicle","plate_number":null,"archived_at":null,"deleted_at":null,"due_soon_ratio":null}}]%s}`, syncDevice, field)
		}
	}
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if sid != "" {
		req.AddCookie(&http.Cookie{Name: "sid", Value: sid})
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: "csrf_token", Value: cookie})
	}
	req.Header.Set("X-CSRF-Token", header)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	return response
}

func TestSyncAccountBindingHTTP(t *testing.T) {
	for _, endpoint := range []string{"devices/register", "sync/push", "sync/pull"} {
		for _, test := range []struct {
			name, expected, sid, cookie, header string
			status                              int
		}{
			{"missing session", syncAccountA, "", "csrf", "csrf", 401},
			{"expired session", syncAccountA, "expired", "csrf", "csrf", 401},
			{"missing expected account", "missing", "session-a", "csrf", "csrf", 400},
			{"empty expected account", "", "session-a", "csrf", "csrf", 400},
			{"malformed expected account", "not-a-uuid", "session-a", "csrf", "csrf", 400},
			{"stale account despite registered device", syncAccountA, "session-b", "csrf", "csrf", 409},
			{"matching account A", syncAccountA, "session-a", "csrf", "csrf", 200},
			{"matching account B", syncAccountB, "session-b", "csrf", "csrf", 200},
			{"response uses session identity not request spelling", strings.ToUpper(syncAccountA), "session-a", "csrf", "csrf", 200},
			{"missing csrf", syncAccountA, "session-a", "", "", 403},
			{"wrong csrf cookie", syncAccountA, "session-a", "wrong", "csrf", 403},
			{"wrong csrf header", syncAccountA, "session-a", "csrf", "wrong", 403},
		} {
			if endpoint == "sync/pull" && test.status == 403 {
				continue // Read-only pull does not require CSRF.
			}
			t.Run(endpoint+"/"+test.name, func(t *testing.T) {
				users, data := &syncUserDependencies{}, &syncDataDependencies{}
				server := New(&Service{User: user.NewService(users, time.Hour), DataSync: datasync.NewService(data, 100, 100)}, config.Config{SessionTTL: time.Hour}, zap.NewNop())
				response := syncHTTPRequest(server.Handler(), endpoint, test.expected, test.sid, test.cookie, test.header)
				if response.Code != test.status {
					t.Errorf("status=%d want=%d body=%s", response.Code, test.status, response.Body)
				}
				calls := users.registerCalls + data.deviceCalls + data.mutationCalls + data.pullCalls
				if test.status != 200 {
					if calls != 0 {
						t.Errorf("rejected request performed application work: users=%+v data=%+v", users, data)
					}
					assertSyncError(t, response, test.status)
					return
				}
				var result struct {
					AccountID string `json:"account_id"`
				}
				if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
					t.Fatal(err)
				}
				wantAccount := syncAccountA
				if test.sid == "session-b" {
					wantAccount = syncAccountB
				}
				if result.AccountID != wantAccount {
					t.Errorf("response identity=%q want=%q", result.AccountID, wantAccount)
				}
				wantRegister, wantDevice, wantMutation, wantPull := 0, 0, 0, 0
				if endpoint == "devices/register" {
					wantRegister = 1
				} else if endpoint == "sync/push" {
					wantDevice, wantMutation = 1, 1
				} else {
					wantPull = 1
				}
				if users.registerCalls != wantRegister || data.deviceCalls != wantDevice || data.mutationCalls != wantMutation || data.pullCalls != wantPull {
					t.Errorf("unexpected application calls: users=%+v data=%+v body=%s", users, data, response.Body)
				}
				accountID := data.accountID
				if endpoint == "devices/register" {
					accountID = users.accountID
				}
				if accountID != wantAccount {
					t.Errorf("application identity=%q want=%q", accountID, wantAccount)
				}
			})
		}
	}
}

func assertSyncError(t *testing.T, response *httptest.ResponseRecorder, status int) {
	t.Helper()
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
	wantCode := "validation_failed"
	if status == 401 {
		wantCode = "session_expired"
	}
	if result.Error.Code != wantCode || result.Error.Retryable {
		t.Errorf("unexpected error: %s", response.Body)
	}
	if status == 409 && result.Error.Message != "The session changed. Refresh and try again." {
		t.Errorf("unsafe mismatch message: %s", response.Body)
	}
}
