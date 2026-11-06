package config

import (
	"fmt"
	"net/mail"
	"net/url"
	"strings"
	"time"
)

func (c Config) ValidateMail() error {
	u, err := url.Parse(c.MailFrontendURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || (u.Path != "" && u.Path != "/") || (u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))) {
		return fmt.Errorf("MAIL_FRONTEND_URL must be a fixed HTTPS origin (HTTP localhost is allowed for development)")
	}
	from, err := mail.ParseAddress(c.SMTPFrom)
	if err != nil || from.Address != c.SMTPFrom || strings.ContainsAny(c.SMTPFrom, "\r\n") {
		return fmt.Errorf("SMTP_FROM must be a single email address")
	}
	if strings.TrimSpace(c.SMTPHost) == "" || strings.ContainsAny(c.SMTPHost, "\r\n /@") || c.SMTPPort < 1 || c.SMTPPort > 65535 || c.SMTPTimeout <= 0 || c.SMTPTimeout > 15*time.Second {
		return fmt.Errorf("invalid SMTP host, port, or timeout (must be within 0–15 seconds)")
	}
	if (c.SMTPUsername == "") != (c.SMTPPassword == "") || (c.SMTPUsername != "" && !c.SMTPStartTLS) {
		return fmt.Errorf("SMTP credentials require both username/password and STARTTLS")
	}
	if c.Environment == "production" && (!c.SMTPStartTLS || u.Scheme != "https" || !c.CookieSecure) {
		return fmt.Errorf("production mail requires STARTTLS, an HTTPS frontend origin, and COOKIE_SECURE=true")
	}
	return nil
}
