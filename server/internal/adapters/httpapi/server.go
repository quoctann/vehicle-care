// Package httpapi exposes application use cases through Gin HTTP routes.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.uber.org/zap"
)

const (
	requestIDKey = "request_id"
	sessionIDKey = "session_id"
	sessionKey   = "session"
	accountKey   = "account"
)

// Pinger reports whether a backing dependency (database, cache, ...) is
// reachable. Both the PostgreSQL and Redis adapters implement it.
type Pinger interface {
	Ping(ctx context.Context) error
}

// Server owns the HTTP adapter and its transport configuration.
type Server struct {
	service *application.Service
	cfg     config.Config
	logger  *zap.Logger
	router  *gin.Engine
	pingers []Pinger
}

// New creates a configured API router. pingers is optional and is checked by
// /health/ready; pass the live store adapters in production so readiness
// reflects real dependency health instead of always reporting ready.
func New(service *application.Service, cfg config.Config, logger *zap.Logger, pingers ...Pinger) *Server {
	if cfg.Environment == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	s := &Server{service: service, cfg: cfg, logger: logger, pingers: pingers}
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
	s.router.GET("/health/ready", s.healthReady)

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
	authenticated.GET("/part-types", s.listPartTypes)

	protected := authenticated.Group("")
	protected.Use(s.requireCSRF())
	protected.POST("/auth/logout", s.logout)
	protected.POST("/devices/register", s.registerDevice)
	protected.POST("/sync/push", s.push)
}

// healthReady reports 503 if any backing dependency (Postgres, Redis) fails a
// short ping, so orchestrators don't route traffic to an instance that can't
// actually serve requests.
func (s *Server) healthReady(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	for _, pinger := range s.pingers {
		if err := pinger.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"status": "ready"})
}
