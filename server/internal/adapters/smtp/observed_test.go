package smtp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

type failingSender struct{ err error }

func (s failingSender) Send(context.Context, user.MailMessage) error { return s.err }

func TestObservedSenderRedactsSecrets(t *testing.T) {
	core, logs := observer.New(zap.WarnLevel)
	secret := "SENTINEL_PRIVATE_MAIL_SECRET"
	sender := Observe(failingSender{err: errors.New(secret)}, zap.New(core))
	ctx := logging.WithRequestID(context.Background(), "req_safe")
	err := sender.Send(ctx, user.MailMessage{To: secret + "@example.com", Subject: secret, Text: secret, HTML: secret, Purpose: "reset"})
	if err == nil || logs.Len() != 1 {
		t.Fatal("delivery failure must be observed")
	}
	entry := logs.All()[0]
	fields := entry.ContextMap()
	if fields["request_id"] != "req_safe" || fields["code"] != "mail_delivery_failed" || fields["purpose"] != "reset" || len(fields) != 3 {
		t.Fatalf("unexpected diagnostic fields: %v", fields)
	}
	if strings.Contains(entry.Message, secret) {
		t.Fatal("secret leaked into log message")
	}
	for _, value := range fields {
		if strings.Contains(value.(string), secret) {
			t.Fatal("secret leaked into diagnostic fields")
		}
	}
	_ = sender.Send(ctx, user.MailMessage{Purpose: secret})
	if logs.All()[1].ContextMap()["purpose"] != "unknown" {
		t.Fatal("purpose must be an allowlisted constant")
	}
	logs.TakeAll()
	if err := Observe(failingSender{}, zap.New(core)).Send(ctx, user.MailMessage{}); err != nil || logs.Len() != 0 {
		t.Fatal("success must not produce failure event")
	}
}
