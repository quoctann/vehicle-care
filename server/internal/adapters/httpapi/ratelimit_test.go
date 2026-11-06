package httpapi

import (
	"context"
	"errors"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
	"net/http"
	"strings"
	"testing"
	"time"
)

type rateStub struct {
	allowed          bool
	denyPrefix       string
	err              error
	retry            time.Duration
	keys             []string
	capacity, refill int
	window           time.Duration
}

func (r *rateStub) AllowRate(_ context.Context, key string, capacity, refill int, window time.Duration) (bool, time.Duration, error) {
	r.keys = append(r.keys, key)
	r.capacity, r.refill, r.window = capacity, refill, window
	if r.denyPrefix != "" && !strings.HasPrefix(key, r.denyPrefix) {
		return true, 0, nil
	}
	return r.allowed, r.retry, r.err
}

func TestLinkRateLimitUsesAccountQuotaAndPreciseRetry(t *testing.T) {
	s, d := googleHTTPServer(t)
	r := &rateStub{denyPrefix: "link:", retry: 180*time.Second + time.Millisecond}
	s.authLimiter = r
	s.apiLimiter = &rateStub{allowed: true}
	w := googleRequest(s, http.MethodPost, "/auth/google/link", `{"password":"password123","expected_account_id":"owner"}`,
		&http.Cookie{Name: "sid", Value: "session"}, &http.Cookie{Name: "csrf_token", Value: "csrf"})
	if w.Code != 429 || w.Header().Get("Retry-After") != "181" || r.capacity != 5 || r.refill != 5 || r.window != 15*time.Minute || r.keys[len(r.keys)-1] != "link:owner" || len(d.states) != 0 {
		t.Fatal(w.Code, w.Header(), r)
	}
}
func (r *rateStub) AllowAuth(context.Context, string, int, time.Duration) (bool, error) {
	panic("must use richer limiter")
}

func TestAPIRateLimit(t *testing.T) {
	r := &rateStub{retry: 1500 * time.Millisecond}
	s := New(&Service{APILimiter: r}, config.Config{APIRateLimitPerMinute: 600, APIRateLimitBurst: 120}, zap.NewNop())
	for _, path := range []string{"/health/live", "/health/ready", "/auth/google/callback"} {
		googleRequest(s, http.MethodGet, path, "")
	}
	googleRequest(s, http.MethodOptions, "/auth/login", "")
	if len(r.keys) != 0 {
		t.Fatal("exempt paths consumed quota", r.keys)
	}
	w := googleRequest(s, http.MethodGet, "/sync/pull", "")
	if w.Code != 429 || w.Header().Get("Retry-After") != "2" || !strings.Contains(w.Body.String(), `"rate_limited"`) || !strings.Contains(w.Body.String(), `"retryable":true`) {
		t.Fatal(w.Code, w.Header(), w.Body.String())
	}
	if len(r.keys) != 1 || r.keys[0] != "api:ip:192.0.2.1" || r.capacity != 120 || r.refill != 600 || r.window != time.Minute {
		t.Fatalf("quota %+v", r)
	}
	r.err = errors.New("redis secret connection failure")
	w = googleRequest(s, http.MethodPost, "/auth/login", "")
	if w.Code != 503 || strings.Contains(w.Body.String(), "secret") {
		t.Fatal(w.Code, w.Body.String())
	}
	r.err = nil
	w = googleRequest(s, http.MethodGet, "/auth/google/start", "")
	if w.Code != 302 || !strings.Contains(w.Header().Get("Location"), "google_error=unavailable") {
		t.Fatal(w.Code, w.Header())
	}
}

func TestRateLimitProductionMissingAndAuthRetry(t *testing.T) {
	s := New(&Service{}, config.Config{Environment: "production"}, zap.NewNop())
	if w := googleRequest(s, http.MethodPost, "/auth/login", ""); w.Code != 503 {
		t.Fatal("production failed open", w.Code)
	}
	r := &rateStub{retry: 2100 * time.Millisecond}
	s = New(&Service{AuthLimiter: r, APILimiter: &rateStub{allowed: true}}, config.Config{}, zap.NewNop())
	w := googleRequest(s, http.MethodPost, "/auth/login", "")
	if w.Code != 429 || w.Header().Get("Retry-After") != "3" || r.capacity != 30 || r.refill != 30 || r.window != time.Minute || r.keys[0] != "ip:192.0.2.1" {
		t.Fatal(w.Code, w.Header(), r)
	}
}

func TestRateLimitAllowsAndKeepsQuotasSeparate(t *testing.T) {
	api, auth := &rateStub{allowed: true}, &rateStub{allowed: true}
	s := New(&Service{APILimiter: api, AuthLimiter: auth}, config.Config{}, zap.NewNop())
	w := googleRequest(s, http.MethodGet, "/auth/google/start", "")
	if w.Code != 302 || len(api.keys) != 1 || len(auth.keys) != 1 || api.keys[0] == auth.keys[0] {
		t.Fatal(w.Code, api, auth)
	}
	if api.capacity != 120 || api.refill != 600 {
		t.Fatal("zero config did not get defaults", api)
	}
	// Existing wiring only supplies AuthLimiter: Redis satisfies both ports.
	s = New(&Service{AuthLimiter: auth}, config.Config{}, zap.NewNop())
	before := len(auth.keys)
	googleRequest(s, http.MethodGet, "/auth/google/start", "")
	if len(auth.keys) != before+2 {
		t.Fatal("automatic API limiter wiring missing")
	}
	s = New(&Service{APILimiter: api}, config.Config{Environment: "production"}, zap.NewNop())
	if w := googleRequest(s, http.MethodPost, "/auth/login", ""); w.Code != 503 {
		t.Fatal("missing production auth limiter failed open", w.Code)
	}
	legacy := &googleHTTPDependencies{deny: true}
	s = New(&Service{AuthLimiter: legacy}, config.Config{}, zap.NewNop())
	if w := googleRequest(s, http.MethodPost, "/auth/login", ""); w.Code != 429 || w.Header().Get("Retry-After") != "60" {
		t.Fatal(w.Code, w.Header())
	}
	legacy.down = true
	if w := googleRequest(s, http.MethodPost, "/auth/login", ""); w.Code != 503 {
		t.Fatal(w.Code)
	}
	// Rich denial with no supplied duration still emits a positive integer.
	api.allowed = false
	s = New(&Service{APILimiter: api}, config.Config{}, zap.NewNop())
	if w := googleRequest(s, http.MethodGet, "/sync/pull", ""); w.Header().Get("Retry-After") != "1" {
		t.Fatal(w.Header())
	}
}
