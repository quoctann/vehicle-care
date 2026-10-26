package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

type AuthLimiter interface {
	AllowAuth(context.Context, string, int, time.Duration) (bool, error)
}

func (s *Server) rateAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		if s.authLimiter == nil {
			c.Next()
			return
		}
		ok, err := s.authLimiter.AllowAuth(c.Request.Context(), "ip:"+c.ClientIP(), 30, time.Minute)
		if err != nil || !ok {
			if c.Request.URL.Path == "/auth/google/start" {
				s.googleRedirect(c, "login", "unavailable")
			} else {
				s.writeAuthLimitError(c, err)
			}
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) writeAuthLimitError(c *gin.Context, err error) {
	status, code := http.StatusTooManyRequests, app.ECRateLimited
	if err != nil {
		status, code = http.StatusServiceUnavailable, app.ECInternalError
	}
	s.writeAPIError(c, status, code, "Authentication temporarily unavailable.", true)
}

func googleHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
}
func (s *Server) googleRedirect(c *gin.Context, purpose, code string) {
	googleHeaders(c)
	path := "/sign-in?google_error="
	if purpose == "link" {
		path = "/settings?google_error="
	}
	switch code {
	case "cancelled", "expired", "email_exists", "identity_linked", "already_linked", "unavailable", "failed":
	default:
		code = "failed"
	}
	c.Redirect(http.StatusFound, strings.TrimRight(s.cfg.FrontendRedirectURL, "/")+path+code)
}
func (s *Server) googleCookie(c *gin.Context, state, value string, age int) {
	if state == "" || len(state) > 256 {
		return
	}
	c.SetSameSite(http.SameSiteLaxMode)
	// __Host prevents sibling-subdomain cookie tossing over HTTPS.
	path := "/auth/google"
	if s.cfg.CookieSecure {
		path = "/"
	}
	c.SetCookie(s.googleCookieName(state), value, age, path, "", s.cfg.CookieSecure, true)
}
func (s *Server) googleCookieName(state string) string {
	// Each transaction owns a distinct cookie, so an older callback cannot
	// overwrite or clear another pending browser binding. Names reveal no state.
	digest := sha256.Sum256([]byte(state))
	suffix := hex.EncodeToString(digest[:16])
	if s.cfg.CookieSecure {
		return "__Host-google_browser_" + suffix
	}
	return "google_browser_" + suffix
}
func (s *Server) setGoogleTransactionCookie(c *gin.Context, authorizationURL, browser string) bool {
	u, err := url.Parse(authorizationURL)
	if err != nil {
		return false
	}
	state := u.Query().Get("state")
	if state == "" || len(state) > 256 {
		return false
	}
	s.googleCookie(c, state, browser, int(user.GoogleStateTTL.Seconds()))
	return true
}
func (s *Server) googleStart(c *gin.Context) {
	googleHeaders(c)
	if !s.cfg.GoogleOAuthEnabled || s.googleService == nil {
		s.googleRedirect(c, "login", "unavailable")
		return
	}
	browser := user.NewGoogleBrowserBinding()
	sid, _ := c.Cookie("sid")
	url, err := s.googleService.Begin(c.Request.Context(), browser, "login", sid, "", "")
	if err != nil {
		s.googleRedirect(c, "login", user.GoogleErrorCode(err))
		return
	}
	if !s.setGoogleTransactionCookie(c, url, browser) {
		s.googleRedirect(c, "login", "failed")
		return
	}
	c.Redirect(http.StatusFound, url)
}
func (s *Server) googleLink(c *gin.Context) {
	googleHeaders(c)
	if !s.cfg.GoogleOAuthEnabled || s.googleService == nil {
		s.writeAPIError(c, http.StatusServiceUnavailable, app.ECInternalError, "Google linking is unavailable.", true)
		return
	}
	if s.authLimiter != nil {
		ok, err := s.authLimiter.AllowAuth(c.Request.Context(), "link:"+mustAccount(c).ID, 5, 15*time.Minute)
		if err != nil || !ok {
			s.writeAuthLimitError(c, err)
			return
		}
	}
	var req struct {
		Password string `json:"password" binding:"required"`
		Expected string `json:"expected_account_id" binding:"required"`
	}
	if !s.bind(c, &req) {
		return
	}
	browser := user.NewGoogleBrowserBinding()
	url, err := s.googleService.Begin(c.Request.Context(), browser, "link", c.GetString(sessionIDKey), req.Expected, req.Password)
	if err != nil {
		var ae *app.Error
		if errors.As(err, &ae) {
			s.writeError(c, err)
			return
		}
		code := user.GoogleErrorCode(err)
		status := http.StatusConflict
		if code == "unavailable" {
			status = 503
		}
		s.writeAPIError(c, status, app.ECValidationFailed, code, false)
		return
	}
	if !s.setGoogleTransactionCookie(c, url, browser) {
		s.writeAPIError(c, http.StatusInternalServerError, app.ECInternalError, "Google linking is unavailable.", true)
		return
	}
	c.JSON(http.StatusOK, gin.H{"authorization_url": url})
}
func (s *Server) googleCallback(c *gin.Context) {
	googleHeaders(c)
	state := c.Query("state")
	browser, _ := c.Cookie(s.googleCookieName(state))
	sid, _ := c.Cookie("sid")
	s.googleCookie(c, state, "", -1)
	if !s.cfg.GoogleOAuthEnabled || s.googleService == nil {
		purpose := "login"
		if strings.HasPrefix(c.Query("state"), "link.") {
			purpose = "link"
		}
		s.googleRedirect(c, purpose, "unavailable")
		return
	}
	// Consume the transaction even on provider cancellation/error.
	code := c.Query("code")
	if c.Query("error") != "" {
		code = ""
	}
	result, err := s.googleService.Complete(c.Request.Context(), c.Query("state"), browser, code, c.Query("error") == "access_denied", sid)
	if err != nil {
		s.googleRedirect(c, result.Purpose, user.GoogleErrorCode(err))
		return
	}
	path := "/"
	if result.Purpose == "link" {
		path = "/settings?google=linked"
	} else {
		s.setAuthCookies(c, result.SessionID, result.CSRFToken)
	}
	c.Redirect(http.StatusFound, strings.TrimRight(s.cfg.FrontendRedirectURL, "/")+path)
}
func (s *Server) googleStatus(c *gin.Context) {
	googleHeaders(c)
	a := mustAccount(c)
	expected := c.Query("expected_account_id")
	if expected == "" {
		s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "expected_account_id is required.", false)
		return
	}
	if expected != a.ID {
		s.writeAPIError(c, http.StatusConflict, app.ECValidationFailed, "The session changed. Refresh and try again.", false)
		return
	}
	linked := false
	hasPassword := len(a.PasswordHash) > 0
	if s.googleService != nil {
		var err error
		linked, hasPassword, err = s.googleService.Status(c.Request.Context(), a.ID)
		if err != nil {
			s.writeAPIError(c, 503, app.ECInternalError, "Authentication temporarily unavailable.", true)
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"enabled": s.cfg.GoogleOAuthEnabled, "linked": linked, "has_password": hasPassword})
}
