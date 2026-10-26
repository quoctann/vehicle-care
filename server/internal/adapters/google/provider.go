// Package google implements Google's OIDC authorization-code/PKCE protocol.
package google

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"golang.org/x/oauth2"
)

type Provider struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
	client   *http.Client
}

func New(ctx context.Context, id, secret, redirect string) (*Provider, error) {
	return newProvider(ctx, id, secret, redirect, "https://accounts.google.com")
}
func newProvider(ctx context.Context, id, secret, redirect, issuer string) (*Provider, error) {
	client := &http.Client{Timeout: 10 * time.Second}
	ctx = oidc.ClientContext(ctx, client)
	provider, err := oidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, errors.New("Google OIDC discovery unavailable")
	}
	return &Provider{oauth: oauth2.Config{ClientID: id, ClientSecret: secret, RedirectURL: redirect, Endpoint: provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "email", "profile"}}, verifier: provider.Verifier(&oidc.Config{ClientID: id}), client: client}, nil
}
func (p *Provider) AuthorizationURL(state, nonce, verifier string) string {
	return p.oauth.AuthCodeURL(state, oidc.Nonce(nonce), oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("prompt", "select_account"))
}
func (p *Provider) Verify(ctx context.Context, code, nonce, verifier string) (user.GoogleClaims, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	ctx = oidc.ClientContext(ctx, p.client)
	token, err := p.oauth.Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return user.GoogleClaims{}, errors.New("Google authorization failed")
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return user.GoogleClaims{}, errors.New("missing ID token")
	}
	id, err := p.verifier.Verify(ctx, raw)
	if err != nil {
		return user.GoogleClaims{}, errors.New("invalid ID token")
	}
	var claims struct {
		Email    string `json:"email"`
		Name     string `json:"name"`
		Verified bool   `json:"email_verified"`
		HD       string `json:"hd"`
		AZP      string `json:"azp"`
	}
	if err := id.Claims(&claims); err != nil {
		return user.GoogleClaims{}, errors.New("invalid identity claims")
	}
	if !claims.Verified || id.Subject == "" || nonce == "" || subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(nonce)) != 1 || (len(id.Audience) > 1 && claims.AZP != p.oauth.ClientID) || (claims.AZP != "" && claims.AZP != p.oauth.ClientID) {
		return user.GoogleClaims{}, errors.New("invalid identity claims")
	}
	email := strings.ToLower(strings.TrimSpace(claims.Email))
	trusted := strings.HasSuffix(email, "@gmail.com") || strings.TrimSpace(claims.HD) != ""
	return user.GoogleClaims{Subject: id.Subject, Email: email, Name: claims.Name, EmailTrusted: trusted}, nil
}
