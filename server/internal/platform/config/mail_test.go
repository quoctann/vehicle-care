package config

import (
	"testing"
	"time"
)

func TestValidateMail(t *testing.T) {
	base := Config{Environment: "development", MailFrontendURL: "http://localhost:5173", SMTPHost: "localhost", SMTPPort: 1025, SMTPFrom: "care@example.com", SMTPTimeout: time.Second}
	if err := base.ValidateMail(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Config){
		func(c *Config) { c.MailFrontendURL = "https://evil.test?next=foo" },
		func(c *Config) { c.MailFrontendURL = "https://user:pass@app.test" },
		func(c *Config) { c.MailFrontendURL = "https://app.test/path" },
		func(c *Config) { c.MailFrontendURL = "http://app.test" },
		func(c *Config) { c.SMTPFrom = "care@example.com\r\nBcc:evil@example.com" },
		func(c *Config) { c.SMTPTimeout = 0 },
		func(c *Config) { c.SMTPPort = 65536 },
		func(c *Config) { c.Environment = "production" },
		func(c *Config) { c.SMTPUsername = "user"; c.SMTPPassword = "password" },
	} {
		cfg := base
		change(&cfg)
		if cfg.ValidateMail() == nil {
			t.Fatalf("expected invalid config: %+v", cfg)
		}
	}
	production := base
	production.Environment = "production"
	production.MailFrontendURL = "https://app.test"
	production.SMTPStartTLS = true
	if err := production.ValidateMail(); err == nil {
		t.Fatal("production mail requires secure cookies independently of Google OAuth")
	}
	production.CookieSecure = true
	if err := production.ValidateMail(); err != nil {
		t.Fatal(err)
	}
}
