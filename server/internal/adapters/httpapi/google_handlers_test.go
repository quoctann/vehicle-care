package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type googleHTTPDependencies struct {
	accountDependencies
	user.IGooglePorts
	states   map[string]user.GoogleState
	hash     []byte
	linked   bool
	deny     bool
	down     bool
	denyLink bool
	downLink bool
	keys     []string
}

func (d *googleHTTPDependencies) AccountByID(_ context.Context, id string) (*domain.Account, error) {
	return &domain.Account{ID: id, PasswordHash: d.hash, AuthVersion: 1}, nil
}
func (d *googleHTTPDependencies) Session(_ context.Context, id string, _ time.Time) (*domain.Session, bool, error) {
	return &domain.Session{AccountID: "owner", AuthVersion: 1}, id == "session", nil
}
func (d *googleHTTPDependencies) SaveGoogleState(_ context.Context, key string, st user.GoogleState, _ time.Duration) error {
	d.states[key] = st
	return nil
}
func (d *googleHTTPDependencies) TakeGoogleState(_ context.Context, key string) (user.GoogleState, bool, error) {
	st, ok := d.states[key]
	delete(d.states, key)
	return st, ok, nil
}
func (d *googleHTTPDependencies) GoogleLinked(context.Context, string) (bool, error) {
	return d.linked, nil
}
func (d *googleHTTPDependencies) GoogleAccount(context.Context, string, string, string, bool) (*domain.Account, error) {
	return &domain.Account{ID: "owner", AuthVersion: 1}, nil
}
func (d *googleHTTPDependencies) LinkGoogle(context.Context, string, string, int64) error {
	d.linked = true
	return nil
}
func (d *googleHTTPDependencies) CreateSession(context.Context, string, domain.Session) error {
	return nil
}
func (d *googleHTTPDependencies) DeleteSession(context.Context, string) error { return nil }
func (d *googleHTTPDependencies) AllowAuth(_ context.Context, key string, _ int, _ time.Duration) (bool, error) {
	d.keys = append(d.keys, key)
	if d.down || (d.downLink && strings.HasPrefix(key, "link:")) {
		return false, errors.New("redis unavailable")
	}
	return !d.deny && !(d.denyLink && strings.HasPrefix(key, "link:")), nil
}

type googleHTTPProvider struct{}

func (googleHTTPProvider) AuthorizationURL(state, nonce, verifier string) string {
	return "https://accounts.test/authorize?state=" + state
}
func (googleHTTPProvider) Verify(context.Context, string, string, string) (user.GoogleClaims, error) {
	return user.GoogleClaims{Subject: "sub", Email: "a@gmail.com", EmailTrusted: true}, nil
}
func googleHTTPServer(t *testing.T) (*Server, *googleHTTPDependencies) {
	t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	d := &googleHTTPDependencies{states: map[string]user.GoogleState{}, hash: hash}
	u := user.NewService(d, time.Hour)
	s := New(&Service{User: u, Google: user.NewGoogleService(u, d, googleHTTPProvider{}), AuthLimiter: d}, config.Config{GoogleOAuthEnabled: true, FrontendRedirectURL: "https://app.test", SessionTTL: time.Hour, CookieDomain: "app.test"}, zap.NewNop())
	return s, d
}
func googleRequest(s *Server, method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.2")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", "csrf")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	r := httptest.NewRecorder()
	s.Handler().ServeHTTP(r, req)
	return r
}
func googleBrowser(t *testing.T, r *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	digest := sha256.Sum256([]byte(googleResponseState(t, r)))
	suffix := hex.EncodeToString(digest[:16])
	for _, c := range r.Result().Cookies() {
		if c.Name == "google_browser_"+suffix || c.Name == "__Host-google_browser_"+suffix {
			if c.Domain != "" || !c.HttpOnly || c.SameSite != http.SameSiteLaxMode || c.MaxAge != 600 {
				t.Fatalf("unsafe browser cookie %+v", c)
			}
			return c
		}
	}
	t.Fatal("missing browser cookie")
	return nil
}
func googleState(t *testing.T, d *googleHTTPDependencies) string {
	t.Helper()
	for k := range d.states {
		return k
	}
	t.Fatal("missing state")
	return ""
}

func TestGoogleHTTPLoginAndReplay(t *testing.T) {
	s, d := googleHTTPServer(t)
	r := googleRequest(s, "GET", "/auth/google/start", "")
	if r.Code != 302 || !strings.HasPrefix(r.Header().Get("Location"), "https://accounts.test/") {
		t.Fatal(r.Code, r.Body.String())
	}
	browser := googleBrowser(t, r)
	key := googleState(t, d)
	if len(d.keys) != 1 || d.keys[0] != "ip:192.0.2.1" {
		t.Fatal("trusted forged proxy", d.keys)
	}
	r = googleRequest(s, "GET", "/auth/google/callback?state="+key+"&code=code", "", browser)
	if r.Code != 302 || r.Header().Get("Location") != "https://app.test/" {
		t.Fatal(r.Code, r.Header())
	}
	if r.Header().Get("Cache-Control") != "no-store" || r.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("missing privacy headers")
	}
	sessionSet := false
	for _, c := range r.Result().Cookies() {
		if c.Name == "sid" && c.Value != "" {
			sessionSet = true
		}
	}
	if !sessionSet {
		t.Fatal("no session")
	}
	r = googleRequest(s, "GET", "/auth/google/callback?state="+key+"&code=code", "", browser)
	if r.Header().Get("Location") != "https://app.test/sign-in?google_error=expired" {
		t.Fatal(r.Header())
	}
}

func TestGoogleHTTPLinkAndCancellation(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "cancelled"}[cancel], func(t *testing.T) {
			s, d := googleHTTPServer(t)
			cookies := []*http.Cookie{{Name: "sid", Value: "session"}, {Name: "csrf_token", Value: "csrf"}}
			r := googleRequest(s, "POST", "/auth/google/link", `{"password":"password123","expected_account_id":"owner"}`, cookies...)
			if r.Code != 200 {
				t.Fatal(r.Code, r.Body.String())
			}
			var out map[string]string
			_ = json.Unmarshal(r.Body.Bytes(), &out)
			if out["authorization_url"] == "" {
				t.Fatal(r.Body.String())
			}
			browser := googleBrowser(t, r)
			key := googleState(t, d)
			cookies = append(cookies, browser)
			suffix := "&code=code"
			want := "https://app.test/settings?google=linked"
			if cancel {
				suffix = "&error=access_denied"
				want = "https://app.test/settings?google_error=cancelled"
			}
			r = googleRequest(s, "GET", "/auth/google/callback?state="+key+suffix, "", cookies...)
			if r.Header().Get("Location") != want || d.linked == cancel {
				t.Fatal(r.Header(), d.linked)
			}
			if len(d.states) != 0 {
				t.Fatal("state not consumed")
			}
			if len(d.keys) != 2 || d.keys[1] != "link:owner" {
				t.Fatal("missing account limiter", d.keys)
			}
			r = googleRequest(s, "GET", "/auth/google/status?expected_account_id=owner", "", cookies...)
			if r.Code != 200 || !strings.Contains(r.Body.String(), `"has_password":true`) {
				t.Fatal(r.Code, r.Body.String())
			}
		})
	}
}

func TestGoogleHTTPFailuresAndRateLimit(t *testing.T) {
	s, d := googleHTTPServer(t)
	cookies := []*http.Cookie{{Name: "sid", Value: "session"}, {Name: "csrf_token", Value: "csrf"}}
	for _, tc := range []struct {
		body   string
		status int
	}{{`{`, 400}, {`{}`, 400}, {`{"password":"wrong","expected_account_id":"owner"}`, 401}, {`{"password":"password123","expected_account_id":"stale"}`, 409}} {
		r := googleRequest(s, "POST", "/auth/google/link", tc.body, cookies...)
		if r.Code != tc.status {
			t.Fatal(r.Code, r.Body.String())
		}
	}
	d.linked = true
	r := googleRequest(s, "POST", "/auth/google/link", `{"password":"password123","expected_account_id":"owner"}`, cookies...)
	if r.Code != 409 {
		t.Fatal(r.Code, r.Body.String())
	}
	d.deny = true
	r = googleRequest(s, "GET", "/auth/google/start", "")
	if r.Header().Get("Location") != "https://app.test/sign-in?google_error=unavailable" {
		t.Fatal(r.Header())
	}
	r = googleRequest(s, "POST", "/auth/login", `{}`)
	if r.Code != 429 {
		t.Fatal(r.Code)
	}
	if !strings.Contains(r.Body.String(), `"code":"rate_limited"`) {
		t.Fatal("throttling must not be reported as invalid credentials", r.Body.String())
	}
	d.deny = false
	d.down = true
	r = googleRequest(s, "POST", "/auth/login", `{}`)
	if r.Code != http.StatusServiceUnavailable || !strings.Contains(r.Body.String(), `"code":"internal_error"`) {
		t.Fatal("limiter failed open", r.Code)
	}
}

func TestGoogleLinkRateLimit(t *testing.T) {
	for _, infrastructureFailure := range []bool{false, true} {
		s, d := googleHTTPServer(t)
		d.denyLink = !infrastructureFailure
		d.downLink = infrastructureFailure
		wantStatus, wantCode := http.StatusTooManyRequests, "rate_limited"
		if infrastructureFailure {
			wantStatus, wantCode = http.StatusServiceUnavailable, "internal_error"
		}
		r := googleRequest(s, http.MethodPost, "/auth/google/link", `{"password":"password123","expected_account_id":"owner"}`,
			&http.Cookie{Name: "sid", Value: "session"}, &http.Cookie{Name: "csrf_token", Value: "csrf"})
		if r.Code != wantStatus || !strings.Contains(r.Body.String(), `"code":"`+wantCode+`"`) {
			t.Fatalf("got %d %s, want %d %s", r.Code, r.Body.String(), wantStatus, wantCode)
		}
		if len(d.states) != 0 {
			t.Fatal("throttled request started OAuth")
		}
	}
}

func TestGoogleStatusExpectedAccount(t *testing.T) {
	for _, tc := range []struct {
		name, query string
		status      int
	}{
		{"missing account", "", http.StatusBadRequest},
		{"empty account", "?expected_account_id=", http.StatusBadRequest},
		{"stale account", "?expected_account_id=other", http.StatusConflict},
		{"matching account", "?expected_account_id=owner", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := googleHTTPServer(t)
			r := googleRequest(s, http.MethodGet, "/auth/google/status"+tc.query, "", &http.Cookie{Name: "sid", Value: "session"})
			if r.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", r.Code, tc.status, r.Body.String())
			}
			if tc.status != http.StatusOK && strings.Contains(r.Body.String(), `"linked"`) {
				t.Fatal("stale request exposed Google account status")
			}
		})
	}
}

func TestGoogleSecureHostCookie(t *testing.T) {
	s, d := googleHTTPServer(t)
	s.cfg.CookieSecure = true
	r := googleRequest(s, "GET", "/auth/google/start", "")
	browser := googleBrowser(t, r)
	if !strings.HasPrefix(browser.Name, "__Host-google_browser_") || !browser.Secure || !browser.HttpOnly || browser.Path != "/" || browser.Domain != "" || browser.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unsafe production binding cookie: %+v", browser)
	}
	r = googleRequest(s, "GET", "/auth/google/callback?state="+googleState(t, d)+"&code=code", "", browser)
	if r.Header().Get("Location") != "https://app.test/" {
		t.Fatal(r.Header())
	}
}

func googleResponseState(t *testing.T, r *httptest.ResponseRecorder) string {
	t.Helper()
	authorizationURL := r.Header().Get("Location")
	if authorizationURL == "" {
		var body struct {
			AuthorizationURL string `json:"authorization_url"`
		}
		if err := json.Unmarshal(r.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		authorizationURL = body.AuthorizationURL
	}
	u, err := url.Parse(authorizationURL)
	if err != nil || u.Query().Get("state") == "" {
		t.Fatal("missing authorization state", authorizationURL, err)
	}
	return u.Query().Get("state")
}

func TestGoogleOverlappingTransactionsKeepIndependentBindingCookies(t *testing.T) {
	for _, secure := range []bool{false, true} {
		for _, purpose := range []string{"login", "link"} {
			for _, failure := range []string{"cancelled", "expired"} {
				t.Run(purpose+"/"+failure+map[bool]string{false: "/http", true: "/https"}[secure], func(t *testing.T) {
					s, d := googleHTTPServer(t)
					s.cfg.CookieSecure = secure
					var sessionCookies []*http.Cookie
					start := func() *httptest.ResponseRecorder { return googleRequest(s, "GET", "/auth/google/start", "") }
					if purpose == "link" {
						sessionCookies = []*http.Cookie{{Name: "sid", Value: "session"}, {Name: "csrf_token", Value: "csrf"}}
						start = func() *httptest.ResponseRecorder {
							return googleRequest(s, "POST", "/auth/google/link", `{"password":"password123","expected_account_id":"owner"}`, sessionCookies...)
						}
					}
					a := start()
					stateA := googleResponseState(t, a)
					cookieA := googleBrowser(t, a)
					b := start()
					stateB := googleResponseState(t, b)
					cookieB := googleBrowser(t, b)
					if cookieA.Name == cookieB.Name {
						t.Fatal("overlapping attempts overwrite the same browser binding cookie")
					}
					if failure == "expired" {
						delete(d.states, stateA)
					}
					jar := append(append([]*http.Cookie{}, sessionCookies...), cookieA, cookieB)
					callbackA := googleRequest(s, "GET", "/auth/google/callback?state="+stateA+"&error=access_denied", "", jar...)
					clearedA := false
					for _, c := range callbackA.Result().Cookies() {
						if c.Name == cookieB.Name {
							t.Fatal("older callback changed newer binding cookie")
						}
						if c.Name == cookieA.Name && c.MaxAge < 0 {
							clearedA = true
						}
					}
					if !clearedA {
						t.Fatal("older transaction binding cookie was not cleared")
					}
					wantPrefix := "https://app.test/sign-in?google_error="
					if purpose == "link" {
						wantPrefix = "https://app.test/settings?google_error="
					}
					if callbackA.Header().Get("Location") != wantPrefix+failure {
						t.Fatal(callbackA.Header())
					}
					callbackB := googleRequest(s, "GET", "/auth/google/callback?state="+stateB+"&code=code", "", append(sessionCookies, cookieB)...)
					want := "https://app.test/"
					if purpose == "link" {
						want = "https://app.test/settings?google=linked"
					}
					if callbackB.Header().Get("Location") != want {
						t.Fatalf("newer transaction failed after older callback: %v", callbackB.Header())
					}
				})
			}
		}
	}
}

func TestGoogleOverlappingLoginExpiresAfterAnotherLoginRotatesSession(t *testing.T) {
	s, _ := googleHTTPServer(t)
	a := googleRequest(s, "GET", "/auth/google/start", "")
	stateA := googleResponseState(t, a)
	cookieA := googleBrowser(t, a)
	b := googleRequest(s, "GET", "/auth/google/start", "")
	stateB := googleResponseState(t, b)
	cookieB := googleBrowser(t, b)
	callbackA := googleRequest(s, "GET", "/auth/google/callback?state="+stateA+"&code=code", "", cookieA, cookieB)
	var sid *http.Cookie
	for _, c := range callbackA.Result().Cookies() {
		if c.Name == "sid" {
			sid = c
		}
	}
	if sid == nil {
		t.Fatal("first login did not establish session")
	}
	callbackB := googleRequest(s, "GET", "/auth/google/callback?state="+stateB+"&code=code", "", sid, cookieB)
	if callbackB.Header().Get("Location") != "https://app.test/sign-in?google_error=expired" {
		t.Fatal("overlapping login ignored changed session", callbackB.Header())
	}
}

func TestGoogleDisabledAndProtectedEndpoints(t *testing.T) {
	s := New(&Service{User: user.NewService(&accountDependencies{}, time.Hour)}, config.Config{FrontendRedirectURL: "https://app.test", SessionTTL: time.Hour}, zap.NewNop())
	for _, tc := range []struct {
		method, path string
		status       int
	}{{"GET", "/auth/google/start", 302}, {"GET", "/auth/google/callback?error=access_denied", 302}, {"GET", "/auth/google/status", 401}, {"POST", "/auth/google/link", 401}} {
		r := httptest.NewRecorder()
		s.Handler().ServeHTTP(r, httptest.NewRequest(tc.method, tc.path, nil))
		if r.Code != tc.status {
			t.Fatal(tc.path, r.Code, r.Body.String())
		}
		if tc.status == 302 && r.Header().Get("Location") != "https://app.test/sign-in?google_error=unavailable" {
			t.Fatal(r.Header())
		}
	}
	req := httptest.NewRequest("GET", "/auth/google/status?expected_account_id=owner", nil)
	req.AddCookie(&http.Cookie{Name: "sid", Value: "session"})
	r := httptest.NewRecorder()
	s.Handler().ServeHTTP(r, req)
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"enabled":false`) {
		t.Fatal(r.Code, r.Body.String())
	}
	req = httptest.NewRequest("POST", "/auth/google/link", strings.NewReader(`{"password":"secret","expected_account_id":"owner"}`))
	req.AddCookie(&http.Cookie{Name: "sid", Value: "session"})
	r = httptest.NewRecorder()
	s.Handler().ServeHTTP(r, req)
	if r.Code != 403 {
		t.Fatal("link not CSRF protected", r.Code)
	}
}
