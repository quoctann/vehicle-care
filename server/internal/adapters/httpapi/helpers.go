package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
)

func (s *Server) bind(c *gin.Context, destination any) bool {
	if err := c.ShouldBindJSON(destination); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			s.writeAPIError(c, http.StatusRequestEntityTooLarge, app.ErrValidationFailed, "Request body exceeds limit", false)
			return false
		}
		s.writeAPIError(c, http.StatusBadRequest, app.ErrValidationFailed, "Request body is invalid.", false)
		return false
	}

	return true
}

func (s *Server) writeError(c *gin.Context, err error) {
	appErr, ok := app.AsError(err)
	if !ok {
		s.logger.Error("request failed", logging.ContextFields(c.Request.Context())...)
		s.writeAPIError(c, http.StatusInternalServerError, app.ErrInternalError, "Internal server error.", true)
		return
	}

	status := http.StatusBadRequest
	retryable := false
	code, message := appErr.Code, appErr.Message

	switch appErr.Code {

	case app.ErrAuthInvalid, app.ErrSessionExpired:
		status = http.StatusUnauthorized

	case app.ErrOwnershipInvalid:
		status = http.StatusForbidden

	case app.ErrConflict:
		status = http.StatusConflict
		code = app.ErrValidationFailed

	case app.ErrValidationFailed:
		status = http.StatusBadRequest

	case app.ErrInternalError:
		status = http.StatusInternalServerError

	default:
		s.logger.Error("request failed with unknown error code", logging.ContextFields(c.Request.Context())...)
		status = http.StatusInternalServerError
		code = app.ErrInternalError
		message = "Internal server error."
	}

	s.writeAPIError(c, status, code, message, retryable)
}

func (s *Server) writeAPIError(c *gin.Context, status int, code, message string, retryable bool) {
	c.JSON(status, gin.H{"error": gin.H{
		"code":       code,
		"message":    message,
		"retryable":  retryable,
		"request_id": c.GetString(requestIDKey),
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
		if (character < 'a' || character > 'z') && (character < 'A' || character > 'Z') &&
			(character < '0' || character > '9') && character != '-' && character != '_' {
			return false
		}
	}

	return true
}
