package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"go.uber.org/zap"
)

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
