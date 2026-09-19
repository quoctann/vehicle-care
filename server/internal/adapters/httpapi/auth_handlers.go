package httpapi

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (s *Server) signup(c *gin.Context) {
	var request struct {
		Email    string  `json:"email" binding:"required"`
		Password string  `json:"password" binding:"required"`
		Name     *string `json:"name"`
	}
	if !s.bind(c, &request) {
		return
	}
	account, sessionID, csrfToken, _, err := s.service.Signup(c.Request.Context(), request.Email, request.Password, request.Name)
	if err != nil {
		s.writeError(c, err)
		return
	}
	s.setAuthCookies(c, sessionID, csrfToken)
	c.JSON(http.StatusCreated, gin.H{"status": "verification_required", "email": account.Email})
}

func (s *Server) login(c *gin.Context) {
	var request struct {
		Email    string `json:"email" binding:"required"`
		Password string `json:"password" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	account, sessionID, csrfToken, err := s.service.Login(c.Request.Context(), request.Email, request.Password)
	if err != nil {
		s.writeError(c, err)
		return
	}
	s.setAuthCookies(c, sessionID, csrfToken)
	c.JSON(http.StatusOK, gin.H{"account": account})
}

func (s *Server) verifyEmail(c *gin.Context) {
	var request struct {
		Token string `json:"token" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	if err := s.service.VerifyEmail(c.Request.Context(), request.Token); err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "verified"})
}

func (s *Server) resendVerification(c *gin.Context) {
	var request struct {
		Email string `json:"email" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	_, _, err := s.service.CreateVerificationToken(c.Request.Context(), request.Email)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

func (s *Server) forgotPassword(c *gin.Context) {
	var request struct {
		Email string `json:"email" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	_, _, err := s.service.CreateResetToken(c.Request.Context(), request.Email)
	if err != nil {
		s.writeError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}

func (s *Server) resetPassword(c *gin.Context) {
	var request struct {
		Token       string `json:"token" binding:"required"`
		NewPassword string `json:"new_password" binding:"required"`
	}
	if !s.bind(c, &request) {
		return
	}
	if err := s.service.ResetPassword(c.Request.Context(), request.Token, request.NewPassword); err != nil {
		s.writeError(c, err)
		return
	}
	s.clearAuthCookies(c)
	c.JSON(http.StatusOK, gin.H{"status": "reset"})
}

func (s *Server) googleStart(c *gin.Context) {
	s.writeAPIError(c, http.StatusBadRequest, "validation_failed", "Google sign-in is not implemented yet.", false)
}

func (s *Server) getSession(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"account": mustAccount(c)})
}

func (s *Server) logout(c *gin.Context) {
	if err := s.service.Logout(c.Request.Context(), c.GetString(sessionIDKey)); err != nil {
		s.writeError(c, err)
		return
	}
	s.clearAuthCookies(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) setAuthCookies(c *gin.Context, sessionID, csrfToken string) {
	c.SetSameSite(http.SameSiteLaxMode)
	maxAge := int(s.cfg.SessionTTL.Seconds())
	c.SetCookie("sid", sessionID, maxAge, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, true)
	c.SetCookie("csrf_token", csrfToken, maxAge, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, false)
}

func (s *Server) clearAuthCookies(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie("sid", "", -1, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, true)
	c.SetCookie("csrf_token", "", -1, "/", s.cfg.CookieDomain, s.cfg.CookieSecure, false)
}
