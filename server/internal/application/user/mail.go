package user

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strings"
	"time"
)

// MailMessage is deliberately transport-neutral. Tokens must never be logged.
type MailMessage struct {
	To      string
	Subject string
	Text    string
	HTML    string
	Purpose string
}

type IMailer interface {
	Send(context.Context, MailMessage) error
}

type IMailLimiter interface {
	AllowAuth(context.Context, string, int, time.Duration) (bool, error)
}

type mailDelivery struct {
	sender      IMailer
	limiter     IMailLimiter
	frontendURL string
	timeout     time.Duration
}

// WithMailDelivery returns a configured copy; startup owns configuration validation.
func (s *Service) WithMailDelivery(sender IMailer, limiter IMailLimiter, frontendURL string, timeout time.Duration) *Service {
	copy := *s
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	copy.mail = &mailDelivery{
		sender:      sender,
		limiter:     limiter,
		frontendURL: strings.TrimRight(frontendURL, "/"),
		timeout:     timeout,
	}
	return &copy
}

func (s *Service) allowMail(ctx context.Context, email string) bool {
	if s.mail == nil {
		return true
	} // Existing non-delivery application consumers.
	if s.mail.limiter == nil {
		return false
	} // Fail closed in configured delivery mode.
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	ok, err := s.mail.limiter.AllowAuth(ctx, "mail:recipient:"+hex.EncodeToString(digest[:]), 3, time.Hour)
	return err == nil && ok
}

// Best-effort bounded delivery preserves signup sessions and generic recovery
// responses. A failed SMTP attempt can be retried through resend/forgot later.
func (s *Service) sendTokenMail(ctx context.Context, email string, kind TokenKind, token string) {
	if s.mail == nil || s.mail.sender == nil {
		return
	}
	path, subject, ttl := "/verify-email", "Verify your Vehicle Care email", "24 hours"
	if kind == TokenKindReset {
		path, subject, ttl = "/reset-password", "Reset your Vehicle Care password", "30 minutes"
	}
	link := s.mail.frontendURL + path + "#" + url.Values{"token": []string{token}}.Encode()
	text := subject + "\n\nOpen this link to continue:\n" + link + "\n\nThis link expires in " + ttl + ". If you did not request this email, you can ignore it.\n"
	html, err := renderTokenHTML(subject, link, ttl)
	if err != nil {
		return
	}
	sendCtx, cancel := context.WithTimeout(ctx, s.mail.timeout)
	defer cancel()
	_ = s.mail.sender.Send(sendCtx, MailMessage{To: email, Subject: subject, Text: text, HTML: html, Purpose: string(kind)})
}
