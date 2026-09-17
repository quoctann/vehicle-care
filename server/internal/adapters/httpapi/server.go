// Package httpapi exposes application use cases through Gin HTTP routes.
package httpapi

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
)

const (
	requestIDKey = "request_id"
	sessionIDKey = "session_id"
	sessionKey   = "session"
	accountKey   = "account"
)

// Server owns the HTTP adapter and its transport configuration.
type Server struct {
	service *application.Service
	cfg     config.Config
	logger  *zap.Logger
	router  *gin.Engine
}

// New creates a configured API router.
func New(service *application.Service, cfg config.Config, logger *zap.Logger) *Server {
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	s := &Server{service: service, cfg: cfg, logger: logger}
	router := gin.New()
	router.Use(s.requestID(), s.cors(), s.limitBody(), s.recovery(), s.accessLog())
	s.router = router
	s.routes()
	return s
}

// Handler returns the API's standard HTTP handler.
func (s *Server) Handler() http.Handler { return s.router }

func (s *Server) routes() {
	s.router.GET("/health/live", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	s.router.GET("/health/ready", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ready"}) })

	s.router.POST("/auth/signup", s.signup)
	s.router.POST("/auth/login", s.login)
	s.router.POST("/auth/verify-email", s.verifyEmail)
	s.router.POST("/auth/verify-email/resend", s.resendVerification)
	s.router.POST("/auth/password/forgot", s.forgotPassword)
	s.router.POST("/auth/password/reset", s.resetPassword)
	s.router.GET("/auth/google/start", s.googleStart)

	authenticated := s.router.Group("")
	authenticated.Use(s.requireSession())
	authenticated.GET("/auth/session", s.getSession)
	authenticated.GET("/sync/pull", s.pull)

	protected := authenticated.Group("")
	protected.Use(s.requireCSRF())
	protected.POST("/auth/logout", s.logout)
	protected.POST("/devices/register", s.registerDevice)
	protected.POST("/sync/push", s.push)
}

func (s *Server) signup(c *gin.Context) {
	var request struct {
		Email    string  `json:"email" binding:"required"`
		Password string  `json:"password" binding:"required"`
		Name     *string `json:"name"`
	}
	if !s.bind(c, &request) {
		return
	}
	account, sessionID, csrfToken, _, err := s.service.Signup(c.Request.Context(), request.Email, request.Password, request.Name)
	if err != nil {
		s.writeError(c, err)
		return
	}
	s.setAuthCookies(c, sessionID, csrfToken)
	c.JSON(http.StatusCreated, gin.H{"status": "verification_required", "email": account.Email})
}

func (s *Server) login(c *gin.Context) {
	var request struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	account, sessionID, csrfToken, err := s.service.Login(c.Request.Context(), request.Email, request.Password)
	if err != nil {
		s.writeError(c, err)
		return
	}
	s.setAuthCookies(c, sessionID, csrfToken)
	c.JSON(http.StatusOK, gin.H{"account": account})
}

func (s *Server) verifyEmail(c *gin.Context) {
	var request struct {
		Token string `json:"token" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	if err := s.service.VerifyEmail(c.Request.Context(), request.Token); err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "verified"})
}

func (s *Server) resendVerification(c *gin.Context) {
	var request struct {
		Email string `json:"email" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	_, _, err := s.service.CreateVerificationToken(c.Request.Context(), request.Email)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

func (s *Server) forgotPassword(c *gin.Context) {
	var request struct {
		Email string `json:"email" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	_, _, err := s.service.CreateResetToken(c.Request.Context(), request.Email)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

func (s *Server) resetPassword(c *gin.Context) {
	var request struct {
		Token       string `json:"token" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	if err := s.service.ResetPassword(c.Request.Context(), request.Token, request.NewPassword); err != nil {
		s.writeError(c, err)
		return
	}
	s.clearAuthCookies(c)
	c.JSON(http.StatusOK, gin.H{"status": "reset"})
}

func (s *Server) googleStart(c *gin.Context) {
	if !s.cfg.MockAuthEnabled {
		s.writeAPIError(c, http.StatusNotFound, "validation_failed", "Mock Google authentication is disabled.", false)
		return
	}
	sessionID, csrfToken, err := s.service.LoginGoogleDemo(c.Request.Context())
	if err != nil {
		s.writeError(c, err)
		return
	}
	s.setAuthCookies(c, sessionID, csrfToken)
	c.Redirect(http.StatusFound, s.cfg.FrontendRedirectURL)
}

func (s *Server) getSession(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"account": mustAccount(c)})
}

func (s *Server) logout(c *gin.Context) {
	if err := s.service.Logout(c.Request.Context(), c.GetString(sessionIDKey)); err != nil {
		s.writeError(c, err)
		return
	}
	s.clearAuthCookies(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) registerDevice(c *gin.Context) {
	var request struct {
		DeviceID   string `json:"device_id" binding:"required"`
		Platform   string `json:"platform" binding:"required"`
		AppVersion string `json:"app_version" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	registeredAt, err := s.service.RegisterDevice(c.Request.Context(), mustAccount(c).ID, request.DeviceID)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"device_id": request.DeviceID, "registered_at": registeredAt})
}

func (s *Server) push(c *gin.Context) {
	var request struct {
		DeviceID   string            `json:"device_id" binding:"required"`
		APIVersion string            `json:"api_version" binding:"required"`
		Mutations  []domain.Mutation `json:"mutations" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	results, err := s.service.Push(c.Request.Context(), mustAccount(c).ID, request.DeviceID, request.APIVersion, request.Mutations)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

func (s *Server) pull(c *gin.Context) {
	afterSeq, err := strconv.ParseInt(c.DefaultQuery("after_seq", "0"), 10, 64)
	if err != nil {
		s.writeAPIError(c, http.StatusBadRequest, "validation_failed", "after_seq is invalid.", false)
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if err != nil {
		s.writeAPIError(c, http.StatusBadRequest, "validation_failed", "limit is invalid.", false)
		return
	}
	page, err := s.service.Pull(c.Request.Context(), mustAccount(c).ID, afterSeq, limit, c.Query("watermark"))
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"changes": page.Changes, "next_cursor": page.NextCursor, "watermark": page.Watermark,
		"has_more": page.HasMore, "server_time": time.Now().UTC(),
	})
}

func (s *Server) requireSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		sessionID, err := c.Cookie("sid")
		if err != nil {
			s.writeAPIError(c, http.StatusUnauthorized, "session_expired", "Session expired or missing.", false)
			c.Abort()
			return
		}
		session, account, err := s.service.ResolveSession(c.Request.Context(), sessionID)
		if err != nil {
			s.writeError(c, err)
			c.Abort()
			return
		}
		c.Set(sessionIDKey, sessionID)
		c.Set(sessionKey, session)
		c.Set(accountKey, account)
		s.setAuthCookies(c, sessionID, session.CSRFToken)
		c.Next()
	}
}

func (s *Server) requireCSRF() gin.HandlerFunc {
	return func(c *gin.Context) {
		session := c.MustGet(sessionKey).(domain.Session)
		cookieToken, err := c.Cookie("csrf_token")
		headerToken := c.GetHeader("X-CSRF-Token")
		if err != nil || cookieToken == "" || headerToken == "" || cookieToken != session.CSRFToken || headerToken != session.CSRFToken {
			s.writeAPIError(c, http.StatusForbidden, "validation_failed", "Invalid CSRF token.", false)
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		requestID := c.GetHeader("X-Request-ID")
		if !validRequestID(requestID) {
			requestID = "req_" + uuid.NewString()
		}
		c.Set(requestIDKey, requestID)
		c.Header("X-Request-ID", requestID)
		c.Next()
	}
}

func (s *Server) limitBody() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		c.Next()
	}
}

func (s *Server) cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Origin") == s.cfg.FrontendOrigin {
			c.Header("Access-Control-Allow-Origin", s.cfg.FrontendOrigin)
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Request-ID")
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Header("Vary", "Origin")
		}
		if c.Request.Method == http.MethodOptions {
			c.Status(http.StatusNoContent)
			c.Abort()
			return
		}
		c.Next()
	}
}

func (s *Server) recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", zap.Any("panic", recovered), zap.String("request_id", c.GetString(requestIDKey)))
				s.writeAPIError(c, http.StatusInternalServerError, "internal_error", "Internal server error.", true)
				c.Abort()
			}
		}()
		c.Next()
	}
}

func (s *Server) accessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		c.Next()
		s.logger.Info("http request", zap.String("request_id", c.GetString(requestIDKey)), zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path), zap.Int("status", c.Writer.Status()), zap.Duration("latency", time.Since(started)))
	}
}

func (s *Server) bind(c *gin.Context, destination any) bool {
	if err := c.ShouldBindJSON(destination); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			s.writeAPIError(c, http.StatusRequestEntityTooLarge, "validation_failed", "Request body exceeds 1 MiB.", false)
			return false
		}
		s.writeAPIError(c, http.StatusBadRequest, "validation_failed", "Request body is invalid.", false)
		return false
	}
	return true
}

func (s *Server) writeError(c *gin.Context, err error) {
	appErr, ok := application.AsError(err)
	if !ok {
		s.logger.Error("request failed", zap.Error(err), zap.String("request_id", c.GetString(requestIDKey)))
		s.writeAPIError(c, http.StatusInternalServerError, "internal_error", "Internal server error.", true)
		return
	}
	status := http.StatusBadRequest
	retryable := false
	switch appErr.Code {
	case "auth_invalid", "session_expired":
		status = http.StatusUnauthorized
	case "ownership_invalid":
		status = http.StatusForbidden
	case "conflict":
		status = http.StatusConflict
		appErr.Code = "validation_failed"
	}
	s.writeAPIError(c, status, appErr.Code, appErr.Message, retryable)
}

func (s *Server) writeAPIError(c *gin.Context, status int, code, message string, retryable bool) {
	c.JSON(status, gin.H{"error": gin.H{
		"code": code, "message": message, "retryable": retryable, "request_id": c.GetString(requestIDKey),
	}})
}

func (s *Server) setAuthCookies(c *gin.Context, sessionID, csrfToken string) {
	c.SetSameSite(http.SameSiteLaxMode)
	maxAge := int(s.cfg.SessionTTL.Seconds())
	c.SetCookie("sid", sessionID, maxAge, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, true)
	c.SetCookie("csrf_token", csrfToken, maxAge, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, false)
}

func (s *Server) clearAuthCookies(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("sid", "", -1, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, true)
	c.SetCookie("csrf_token", "", -1, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, false)
}

func mustAccount(c *gin.Context) domain.Account {
	return c.MustGet(accountKey).(domain.Account)
}

func validRequestID(value string) bool {
	if value == "" || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') && (character < '0' || character > '9') && character != '-' && character != '_' {
			return false
		}
	}
	return true
}
