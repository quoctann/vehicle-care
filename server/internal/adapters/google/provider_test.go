package google

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

func TestOIDCVerification(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwk := jose.JSONWebKey{Key: key, KeyID: "test", Algorithm: "RS256", Use: "sig"}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jwk}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var issuer, raw string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": issuer, "authorization_endpoint": issuer + "/authorize", "token_endpoint": issuer + "/token", "jwks_uri": issuer + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{jwk.Public()}})
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "unused", "token_type": "Bearer", "id_token": raw})
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	issuer = srv.URL
	p, err := newProvider(context.Background(), "client", "secret", issuer+"/callback", issuer)
	if err != nil {
		t.Fatal(err)
	}
	start, _ := url.Parse(p.AuthorizationURL("state", "nonce", "verifier"))
	q := start.Query()
	if q.Get("state") != "state" || q.Get("nonce") != "nonce" || q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("scope") != "openid email profile" {
		t.Fatal("missing OAuth protections", q)
	}
	for _, tc := range []struct {
		name    string
		change  func(map[string]any)
		ok      bool
		trusted bool
	}{
		{"gmail", func(m map[string]any) {}, true, true},
		{"third party", func(m map[string]any) { m["email"] = "a@example.test" }, true, false},
		{"workspace", func(m map[string]any) { m["email"] = "a@example.test"; m["hd"] = "example.test" }, true, true},
		{"unverified", func(m map[string]any) { m["email_verified"] = false }, false, false},
		{"signature", func(m map[string]any) {}, false, false},
		{"nonce", func(m map[string]any) { m["nonce"] = "other" }, false, false},
		{"issuer", func(m map[string]any) { m["iss"] = "https://evil.test" }, false, false},
		{"audience", func(m map[string]any) { m["aud"] = "other" }, false, false},
		{"azp", func(m map[string]any) { m["aud"] = []string{"client", "other"}; m["azp"] = "other" }, false, false},
		{"missing azp", func(m map[string]any) { m["aud"] = []string{"client", "other"} }, false, false},
		{"expired", func(m map[string]any) { m["exp"] = time.Now().Add(-time.Hour).Unix() }, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			claims := map[string]any{"iss": issuer, "aud": "client", "sub": "subject", "email": "a@gmail.com", "email_verified": true, "nonce": "nonce", "exp": time.Now().Add(time.Hour).Unix()}
			tc.change(claims)
			b, _ := json.Marshal(claims)
			sig, _ := signer.Sign(b)
			raw, _ = sig.CompactSerialize()
			if tc.name == "signature" {
				claims["sub"] = "tampered"
				b, _ = json.Marshal(claims)
				parts := strings.Split(raw, ".")
				raw = parts[0] + "." + base64.RawURLEncoding.EncodeToString(b) + "." + parts[2]
			}
			got, err := p.Verify(context.Background(), "code", "nonce", "verifier")
			if (err == nil) != tc.ok {
				t.Fatalf("result: %+v %v", got, err)
			}
			if tc.ok && got.EmailTrusted != tc.trusted {
				t.Fatal("wrong email trust policy")
			}
		})
	}
}
