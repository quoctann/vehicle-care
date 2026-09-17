package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/adapters/memory"
	"github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
)

func TestFrontendAuthAndSyncFlow(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)

	login := performJSON(t, handler, http.MethodPost, "/auth/login", map[string]any{
		"email": "demo@vehicle.app", "password": "demo12345",
	}, nil, "")
	if login.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", login.Code, login.Body.String())
	}
	cookies := cookieMap(login.Result().Cookies())
	if cookies["sid"] == nil || !cookies["sid"].HttpOnly || cookies["csrf_token"] == nil || cookies["csrf_token"].HttpOnly {
		t.Fatalf("unexpected auth cookies: %#v", login.Result().Cookies())
	}
	authCookies := []*http.Cookie{cookies["sid"], cookies["csrf_token"]}

	withoutCSRF := performJSON(t, handler, http.MethodPost, "/devices/register", map[string]any{
		"device_id": "device-1", "platform": "web", "app_version": "0.1.0",
	}, authCookies, "")
	if withoutCSRF.Code != http.StatusForbidden {
		t.Fatalf("missing CSRF status=%d body=%s", withoutCSRF.Code, withoutCSRF.Body.String())
	}

	register := performJSON(t, handler, http.MethodPost, "/devices/register", map[string]any{
		"device_id": "device-1", "platform": "web", "app_version": "0.1.0",
	}, authCookies, cookies["csrf_token"].Value)
	if register.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}

	pushBody := map[string]any{
		"device_id": "device-1", "api_version": "1", "mutations": []map[string]any{{
			"mutation_id": "mutation-1", "entity_type": "vehicle", "operation": "create",
			"entity_id": "vehicle-1", "payload": map[string]any{"name": "Demo bike"},
		}},
	}
	push := performJSON(t, handler, http.MethodPost, "/sync/push", pushBody, authCookies, cookies["csrf_token"].Value)
	duplicate := performJSON(t, handler, http.MethodPost, "/sync/push", pushBody, authCookies, cookies["csrf_token"].Value)
	if push.Code != http.StatusOK || duplicate.Code != http.StatusOK {
		t.Fatalf("push statuses=%d,%d bodies=%s %s", push.Code, duplicate.Code, push.Body.String(), duplicate.Body.String())
	}
	var duplicateBody struct {
		Results []struct {
			Status    string `json:"status"`
			ServerSeq int64  `json:"server_seq"`
		} `json:"results"`
	}
	decodeJSON(t, duplicate, &duplicateBody)
	if len(duplicateBody.Results) != 1 || duplicateBody.Results[0].Status != "duplicate" || duplicateBody.Results[0].ServerSeq != 1 {
		t.Fatalf("unexpected duplicate response: %#v", duplicateBody)
	}

	pullRequest := httptest.NewRequest(http.MethodGet, "/sync/pull?after_seq=0&limit=100&watermark=", nil)
	for _, cookie := range authCookies {
		pullRequest.AddCookie(cookie)
	}
	pull := httptest.NewRecorder()
	handler.ServeHTTP(pull, pullRequest)
	if pull.Code != http.StatusOK {
		t.Fatalf("pull status=%d body=%s", pull.Code, pull.Body.String())
	}
	var pullBody struct {
		Changes []struct {
			ServerSeq int64 `json:"server_seq"`
		} `json:"changes"`
		NextCursor int64  `json:"next_cursor"`
		Watermark  string `json:"watermark"`
	}
	decodeJSON(t, pull, &pullBody)
	if len(pullBody.Changes) != 1 || pullBody.NextCursor != 1 || pullBody.Watermark == "" {
		t.Fatalf("unexpected pull response: %#v", pullBody)
	}
}

func TestCORSAndErrorEnvelope(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	request := httptest.NewRequest(http.MethodGet, "/auth/session", nil)
	request.Header.Set("Origin", "http://localhost:5173")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized || response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" || response.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("unexpected response status=%d headers=%v", response.Code, response.Header())
	}
	var body struct {
		Error struct {
			Code      string `json:"code"`
			RequestID string `json:"request_id"`
		} `json:"error"`
	}
	decodeJSON(t, response, &body)
	if body.Error.Code != "session_expired" || body.Error.RequestID == "" {
		t.Fatalf("unexpected error envelope: %#v", body)
	}
}

func TestRejectsOversizedBody(t *testing.T) {
	t.Parallel()
	handler := newTestHandler(t)
	response := performJSON(t, handler, http.MethodPost, "/auth/login", map[string]any{
		"email": "demo@vehicle.app", "password": string(bytes.Repeat([]byte{'a'}, (1<<20)+1)),
	}, nil, "")
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
	}
}

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	store := memory.NewStore()
	service := application.NewService(store, time.Hour, 100, 100)
	if err := service.SeedDemoAccount(context.Background()); err != nil {
		t.Fatalf("seed demo account: %v", err)
	}
	cfg := config.Config{
		Environment: "test", FrontendOrigin: "http://localhost:5173", FrontendRedirectURL: "http://localhost:5173",
		SessionTTL: time.Hour, SyncMaxBatchSize: 100, SyncMaxPageSize: 100, MockAuthEnabled: true,
	}
	return New(service, cfg, zap.NewNop()).Handler()
}

func performJSON(t *testing.T, handler http.Handler, method, path string, body any, cookies []*http.Cookie, csrf string) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	if csrf != "" {
		request.Header.Set("X-CSRF-Token", csrf)
	}
	for _, cookie := range cookies {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	return response
}

func cookieMap(cookies []*http.Cookie) map[string]*http.Cookie {
	result := make(map[string]*http.Cookie, len(cookies))
	for _, cookie := range cookies {
		result[cookie.Name] = cookie
	}
	return result
}

func decodeJSON(t *testing.T, response *httptest.ResponseRecorder, destination any) {
	t.Helper()
	if err := json.Unmarshal(response.Body.Bytes(), destination); err != nil {
		t.Fatalf("decode response %q: %v", response.Body.String(), err)
	}
}
