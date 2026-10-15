package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func (s *Server) updateTimezone(c *gin.Context) {
	var request struct {
		Timezone          string  `json:"timezone" binding:"required"`
		ExpectedAccountID *string `json:"expected_account_id"`
	}
	if !s.bind(c, &request) {
		return
	}

	session := c.MustGet(sessionKey).(domain.Session)
	// This is only a stale-UI precondition; authorization always uses the session.
	if request.ExpectedAccountID != nil && *request.ExpectedAccountID != session.AccountID {
		s.writeAPIError(c, http.StatusConflict, app.ECValidationFailed, "The session changed. Refresh and try again.", false)
		return
	}

	account, err := s.userService.UpdateTimezone(c.Request.Context(), session.AccountID, request.Timezone)
	if err != nil {
		s.writeError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"account": account})
}
