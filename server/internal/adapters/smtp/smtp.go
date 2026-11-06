// Package smtp delivers account mail over SMTP with a bounded connection lifetime.
package smtp

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"mime/multipart"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strings"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

type Options struct {
	Address  string
	Host     string
	From     string
	Username string
	Password string
	StartTLS bool
	Timeout  time.Duration
}

type Sender struct {
	options Options
}

func New(options Options) *Sender {
	return &Sender{
		options: options,
	}
}

func validAddress(value string) bool {
	if strings.ContainsAny(value, "\r\n") {
		return false
	}
	address, err := mail.ParseAddress(value)
	return err == nil && address.Address == value
}

func (s *Sender) Send(ctx context.Context, message user.MailMessage) error {
	if !validAddress(s.options.From) ||
		!validAddress(message.To) ||
		strings.ContainsAny(message.Subject, "\r\n") {
		return errors.New("invalid mail envelope")
	}
	timeout := s.options.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}

	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", s.options.Address)
	if err != nil {
		return errors.New("mail transport unavailable")
	}
	defer conn.Close()

	// Deadline covers greeting, TLS, AUTH, DATA and QUIT, not only dialing.
	deadline, _ := ctx.Deadline()
	_ = conn.SetDeadline(deadline)

	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()

	client, err := smtp.NewClient(conn, s.options.Host)
	if err != nil {
		return errors.New("mail transport unavailable")
	}
	defer client.Close()

	if s.options.StartTLS {
		if err = client.StartTLS(&tls.Config{
			ServerName: s.options.Host,
			MinVersion: tls.VersionTLS12,
		}); err != nil {
			return errors.New("mail TLS unavailable")
		}
	}

	if s.options.Username != "" {
		// Credentials are never sent without TLS, including localhost.
		if !s.options.StartTLS {
			return errors.New("mail authentication requires TLS")
		}
		if err = client.Auth(smtp.PlainAuth("", s.options.Username, s.options.Password, s.options.Host)); err != nil {
			return errors.New("mail authentication failed")
		}
	}

	if err = client.Mail(s.options.From); err != nil {
		return errors.New("mail envelope rejected")
	}

	if err = client.Rcpt(message.To); err != nil {
		return errors.New("mail recipient rejected")
	}

	writer, err := client.Data()
	if err != nil {
		return errors.New("mail delivery failed")
	}

	body, err := encodeMessage(s.options.From, message)
	if err != nil {
		return errors.New("mail encoding failed")
	}

	if _, err = writer.Write(body); err != nil {
		return errors.New("mail delivery failed")
	}

	if err = writer.Close(); err != nil {
		return errors.New("mail delivery failed")
	}

	// SMTP acceptance is the success boundary; a QUIT failure cannot undo it.
	_ = client.Quit()
	return nil
}

func encodeMessage(from string, message user.MailMessage) ([]byte, error) {
	var body bytes.Buffer
	alternatives := multipart.NewWriter(&body)

	for _, part := range []struct{ contentType, text string }{{"text/plain", message.Text}, {"text/html", message.HTML}} {
		writer, err := alternatives.CreatePart(textproto.MIMEHeader{
			"Content-Type":              []string{part.contentType + "; charset=UTF-8"},
			"Content-Transfer-Encoding": []string{"8bit"},
		})
		if err != nil {
			return nil, err
		}
		text := strings.ReplaceAll(strings.ReplaceAll(part.text, "\r\n", "\n"), "\n", "\r\n")
		if _, err = writer.Write([]byte(text)); err != nil {
			return nil, err
		}
	}
	if err := alternatives.Close(); err != nil {
		return nil, err
	}
	headers := "From: " + from + "\r\nTo: " + message.To + "\r\nSubject: " + message.Subject + "\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=" + alternatives.Boundary() + "\r\n\r\n"
	return append([]byte(headers), body.Bytes()...), nil
}
