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
