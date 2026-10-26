package httpapi

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	app "github.com/quoctann/vehicle-care/server/internal/application"
)

type AuthLimiter interface {
	AllowAuth(context.Context, string, int, time.Duration) (bool, error)
}

// RateLimiter supports separate burst/refill quotas and precise retry guidance.
type RateLimiter interface {
	AllowRate(context.Context, string, int, int, time.Duration) (bool, time.Duration, error)
}

func (s *Server) allowAuth(ctx context.Context, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	if limiter, ok := s.authLimiter.(RateLimiter); ok {
		return limiter.AllowRate(ctx, key, limit, limit, window)
	}
	if s.authLimiter == nil {
		if s.cfg.Environment == "production" {
			return false, 0, errors.New("authentication limiter unavailable")
		}
		return true, 0, nil
	}
	ok, err := s.authLimiter.AllowAuth(ctx, key, limit, window)
	// Legacy implementations expose no exact retry time; the whole window is
	// conservative. The Redis adapter always takes the precise path above.
	return ok, window, err
}

func (s *Server) rateAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		ok, retry, err := s.allowAuth(c.Request.Context(), "ip:"+c.ClientIP(), 30, time.Minute)
		if err != nil || !ok {
			s.rejectRate(c, err, retry)
			return
		}
		c.Next()
	}
}

func (s *Server) rateAPI() gin.HandlerFunc {
	return func(c *gin.Context) {
		path := c.Request.URL.Path
		if c.Request.Method == http.MethodOptions || path == "/health/live" || path == "/health/ready" || path == "/auth/google/callback" {
			c.Next()
			return
		}
		if s.apiLimiter == nil {
			if s.cfg.Environment == "production" {
				s.rejectRate(c, errors.New("API limiter unavailable"), 0)
				return
			}
			c.Next()
			return
		}
		capacity, refill := s.cfg.APIRateLimitBurst, s.cfg.APIRateLimitPerMinute
		// Constructors in tests can use a zero-value config; environment loading
		// validates positive values and supplies these defaults in real deployments.
		if capacity == 0 {
			capacity = 120
		}
		if refill == 0 {
			refill = 600
		}
		ok, retry, err := s.apiLimiter.AllowRate(c.Request.Context(), "api:ip:"+c.ClientIP(), capacity, refill, time.Minute)
		if err != nil || !ok {
			s.rejectRate(c, err, retry)
			return
		}
		c.Next()
	}
}

func (s *Server) rejectRate(c *gin.Context, err error, retry time.Duration) {
	if err == nil {
		seconds := retry / time.Second
		if retry%time.Second != 0 {
			seconds++
		}
		if seconds < 1 {
			seconds = 1
		}
		c.Header("Retry-After", strconv.FormatInt(int64(seconds), 10))
	}
	if c.Request.URL.Path == "/auth/google/start" {
		s.googleRedirect(c, "login", "unavailable")
	} else {
		s.writeAuthLimitError(c, err)
	}
	c.Abort()
}

func (s *Server) writeAuthLimitError(c *gin.Context, err error) {
	status, code := http.StatusTooManyRequests, app.ECRateLimited
	if err != nil {
		status, code = http.StatusServiceUnavailable, app.ECInternalError
	}
	s.writeAPIError(c, status, code, "Requests temporarily unavailable.", true)
}
