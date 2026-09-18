package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"go.uber.org/zap"
)

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
