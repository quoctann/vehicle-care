package httpapi

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
)

// The entire lookup/token/delivery path shares a fixed response budget. Do not
// write the generic response before its deadline: that would expose eligibility.
func (s *Server) recoveryContext(c *gin.Context) (context.Context, context.CancelFunc) {
	budget := s.cfg.SMTPTimeout
	if budget <= 0 {
		budget = 5 * time.Second
	}
	return context.WithTimeout(c.Request.Context(), budget)
}
