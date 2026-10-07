package httpapi

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
	"go.uber.org/zap"
)

func (s *Server) bind(c *gin.Context, destination any) bool {
	if err := c.ShouldBindJSON(destination); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			s.writeAPIError(c, http.StatusRequestEntityTooLarge, app.ECValidationFailed, "Request body exceeds limit", false)
			return false
		}
		s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "Request body is invalid.", false)
		return false
	}

	return true
}

func (s *Server) writeError(c *gin.Context, err error) {
	appErr, ok := app.AsError(err)
	if !ok {
		s.logger.Error("request failed", zap.Error(err), zap.String("request_id", c.GetString(requestIDKey)))
		s.writeAPIError(c, http.StatusInternalServerError, app.ECInternalError, "Internal server error.", true)
		return
	}

	status := http.StatusBadRequest
	retryable := false
	code, message := appErr.Code, appErr.Message

	switch appErr.Code {

	case app.ECAuthInvalid, app.ECSessionExpired:
		status = http.StatusUnauthorized

	case app.ECOwnershipInvalid:
		status = http.StatusForbidden

	case app.ECConflict:
		status = http.StatusConflict
		code = app.ECValidationFailed

	case app.ECValidationFailed:
		status = http.StatusBadRequest

	case app.ECInternalError:
		status = http.StatusInternalServerError

	default:
		s.logger.Error("request failed with unknown error code", zap.String("code", appErr.Code), zap.String("request_id", c.GetString(requestIDKey)))
		status = http.StatusInternalServerError
		code = app.ECInternalError
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
