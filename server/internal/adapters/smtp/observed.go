package smtp

import (
	"context"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"go.uber.org/zap"
)

type observedSender struct {
	sender user.IMailer
	logger *zap.Logger
}

// Observe emits a fixed, redacted diagnostic: never log the original SMTP error,
// recipient, token, message, or URL. Failure responses remain generic upstream.
func Observe(sender user.IMailer, logger *zap.Logger) user.IMailer {
	return &observedSender{sender: sender, logger: logger}
}

func (s *observedSender) Send(ctx context.Context, message user.MailMessage) error {
	err := s.sender.Send(ctx, message)
	if err != nil {
		purpose := "unknown"
		if message.Purpose == string(user.TokenKindReset) || message.Purpose == string(user.TokenKindVerification) {
			purpose = message.Purpose
		}
		s.logger.Warn("account mail delivery failed",
			zap.String("request_id", logging.RequestID(ctx)),
			zap.String("code", "mail_delivery_failed"),
			zap.String("purpose", purpose),
		)
	}
	return err
}
