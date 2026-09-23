package httpapi

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/quoctann/vehicle-care/server/internal/domain"
)

func (s *Server) registerDevice(c *gin.Context) {
	var request struct {
		DeviceID   string `json:"device_id" binding:"required"`
		Platform   string `json:"platform" binding:"required"`
		AppVersion string `json:"app_version" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	registeredAt, err := s.userService.RegisterDevice(c.Request.Context(), mustAccount(c).ID, request.DeviceID)
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
	if len(request.Mutations) == 0 {
		s.writeAPIError(c, http.StatusBadRequest, "validation_failed", "mutations must not be empty.", false)
		return
	}
	results, err := s.datasyncService.Push(c.Request.Context(), mustAccount(c).ID, request.DeviceID, request.APIVersion, request.Mutations)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

// listPartTypes returns the fixed part-type catalog. Clients use this as the
// single source of truth for part_type IDs instead of hardcoding their own
// (see .docs/20260919-feedback.md #1 — the previous mismatch caused
// reminder_configs/service_logs FK violations on sync push).
func (s *Server) listPartTypes(c *gin.Context) {
	partTypes, err := s.datasyncService.ListPartTypes(c.Request.Context(), mustAccount(c).ID)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"part_types": partTypes})
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
	var untilSeq *int64
	if rawUntilSeq, ok := c.GetQuery("until_seq"); ok {
		parsedUntilSeq, parseErr := strconv.ParseInt(rawUntilSeq, 10, 64)
		if parseErr != nil {
			s.writeAPIError(c, http.StatusBadRequest, "validation_failed", "until_seq is invalid.", false)
			return
		}
		untilSeq = &parsedUntilSeq
	}
	page, err := s.datasyncService.Pull(c.Request.Context(), mustAccount(c).ID, afterSeq, limit, untilSeq)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"changes": page.Changes, "next_cursor": page.NextCursor, "until_seq": page.UntilSeq,
		"has_more": page.HasMore, "server_time": time.Now().UTC(),
	})
}
