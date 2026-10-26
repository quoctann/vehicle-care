package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func (s *Server) registerDevice(c *gin.Context) {
	var request struct {
		DeviceID          string `json:"device_id" binding:"required"`
		Platform          string `json:"platform" binding:"required"`
		AppVersion        string `json:"app_version" binding:"required"`
		ExpectedAccountID string `json:"expected_account_id"`
	}
	if !s.bind(c, &request) {
		return
	}
	if !s.requireSyncAccount(c, request.ExpectedAccountID) {
		return
	}

	accountID := mustAccount(c).ID
	registeredAt, err := s.userService.RegisterDevice(c.Request.Context(), accountID, request.DeviceID)
	if err != nil {
		s.writeError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"account_id": accountID, "device_id": request.DeviceID, "registered_at": registeredAt})
}

func (s *Server) push(c *gin.Context) {
	var request struct {
		DeviceID          string            `json:"device_id" binding:"required"`
		Mutations         []domain.Mutation `json:"mutations" binding:"required"`
		ExpectedAccountID string            `json:"expected_account_id"`
	}
	if !s.bind(c, &request) {
		return
	}
	if !s.requireSyncAccount(c, request.ExpectedAccountID) {
		return
	}
	if len(request.Mutations) == 0 {
		s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "mutations must not be empty.", false)
		return
	}

	accountID := mustAccount(c).ID
	results, err := s.datasyncService.Push(c.Request.Context(), accountID, request.DeviceID, request.Mutations)
	if err != nil {
		s.writeError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"account_id": accountID, "results": results})
}

// listPartTypes returns this account's mutable catalog as an auxiliary read API.
// Normal client replication, including signup seeds, uses the changefeed.
func (s *Server) listPartTypes(c *gin.Context) {
	partTypes, err := s.datasyncService.ListPartTypes(c.Request.Context(), mustAccount(c).ID)
	if err != nil {
		s.writeError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{"part_types": partTypes})
}

func (s *Server) pull(c *gin.Context) {
	if !s.requireSyncAccount(c, c.Query("expected_account_id")) {
		return
	}

	afterSeq, err := strconv.ParseInt(c.DefaultQuery("after_seq", "0"), 10, 64)
	if err != nil {
		s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "after_seq is invalid.", false)
		return
	}

	limit, err := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if err != nil {
		s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "limit is invalid.", false)
		return
	}

	var untilSeq *int64
	if rawUntilSeq, ok := c.GetQuery("until_seq"); ok {
		parsedUntilSeq, parseErr := strconv.ParseInt(rawUntilSeq, 10, 64)
		if parseErr != nil {
			s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "until_seq is invalid.", false)
			return
		}
		untilSeq = &parsedUntilSeq
	}

	accountID := mustAccount(c).ID
	page, err := s.datasyncService.Pull(c.Request.Context(), accountID, afterSeq, limit, untilSeq)
	if err != nil {
		s.writeError(c, err)
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"account_id": accountID,
		"changes":    page.Changes, "next_cursor": page.NextCursor, "until_seq": page.UntilSeq,
		"has_more": page.HasMore, "server_time": time.Now().UTC(),
	})
}

// requireSyncAccount is a stale-client precondition, not an authorization source.
// All application calls and response identities still use the authenticated account.
func (s *Server) requireSyncAccount(c *gin.Context, expectedAccountID string) bool {
	expected, err := uuid.Parse(expectedAccountID)
	if err != nil {
		s.writeAPIError(c, http.StatusBadRequest, app.ECValidationFailed, "expected_account_id must be a UUID.", false)
		return false
	}
	if expected.String() != mustAccount(c).ID {
		s.writeAPIError(c, http.StatusConflict, app.ECValidationFailed, "The session changed. Refresh and try again.", false)
		return false
	}
	return true
}
