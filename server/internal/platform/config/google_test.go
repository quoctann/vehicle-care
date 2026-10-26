package config

import "testing"

func TestTrustedProxyConfiguration(t *testing.T) {
	for _, p := range []string{"127.0.0.1", "::1", "10.0.0.0/24", "fd00::/64"} {
		if err := (Config{TrustedProxies: []string{p}}).ValidateTrustedProxies(); err != nil {
			t.Fatal(p, err)
		}
	}
	for _, p := range []string{"*", "0.0.0.0/0", "::/0", "proxy.example.test", "not an ip"} {
		if err := (Config{TrustedProxies: []string{p}}).ValidateTrustedProxies(); err == nil {
			t.Fatal("unsafe proxy", p)
		}
	}
}

func TestGoogleConfiguration(t *testing.T) {
	if err := (Config{}).ValidateGoogle(); err != nil {
		t.Fatal(err)
	}
	valid := Config{GoogleOAuthEnabled: true, GoogleClientID: "client", GoogleClientSecret: "secret", GoogleRedirectURL: "http://localhost:8080/auth/google/callback", FrontendRedirectURL: "http://localhost:5173"}
	if err := valid.ValidateGoogle(); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Config){func(c *Config) { c.GoogleClientID = "" }, func(c *Config) { c.GoogleClientSecret = "" }, func(c *Config) { c.GoogleRedirectURL = "https://example.com/wrong" }, func(c *Config) { c.FrontendRedirectURL = "//evil.test" }, func(c *Config) { c.GoogleRedirectURL = "http://example.com/auth/google/callback" }, func(c *Config) { c.Environment = "production" }, func(c *Config) { c.FrontendRedirectURL = "https://app.test/nested" }} {
		c := valid
		change(&c)
		if c.ValidateGoogle() == nil {
			t.Fatal("expected invalid configuration")
		}
	}
}

func TestGoogleProductionRequiresHTTPS(t *testing.T) {
	for _, tc := range []struct {
		name, callback, frontend string
		valid                    bool
	}{
		{"https", "https://app.test/auth/google/callback", "https://app.test", true},
		{"http callback", "http://localhost:8080/auth/google/callback", "https://app.test", false},
		{"http frontend", "https://app.test/auth/google/callback", "http://localhost:5173", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Config{
				Environment: "production", CookieSecure: true, GoogleOAuthEnabled: true,
				GoogleClientID: "client", GoogleClientSecret: "test-secret",
				GoogleRedirectURL: tc.callback, FrontendRedirectURL: tc.frontend,
			}
			if err := cfg.ValidateGoogle(); (err == nil) != tc.valid {
				t.Fatalf("ValidateGoogle() = %v, valid = %v", err, tc.valid)
			}
		})
	}
}
