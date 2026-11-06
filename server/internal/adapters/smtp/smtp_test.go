package smtp

import (
	"bufio"
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"strings"
	"testing"
	"time"

	"github.com/quoctann/vehicle-care/server/internal/application/user"
)

func TestSMTPDelivery(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	messages := make(chan string, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(time.Second))
		reader := bufio.NewReader(conn)
		_, _ = io.WriteString(conn, "220 localhost SMTP\r\n")
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			switch {
			case strings.HasPrefix(line, "EHLO"):
				_, _ = io.WriteString(conn, "250 localhost\r\n")
			case strings.HasPrefix(line, "DATA"):
				_, _ = io.WriteString(conn, "354 continue\r\n")
				var body strings.Builder
				for {
					line, err = reader.ReadString('\n')
					if err != nil {
						return
					}
					if line == ".\r\n" {
						break
					}
					body.WriteString(line)
				}
				messages <- body.String()
				_, _ = io.WriteString(conn, "250 queued\r\n")
			case strings.HasPrefix(line, "QUIT"):
				_, _ = io.WriteString(conn, "221 bye\r\n")
				return
			default:
				_, _ = io.WriteString(conn, "250 ok\r\n")
			}
		}
	}()
	sender := New(Options{Address: listener.Addr().String(), Host: "localhost", From: "care@example.com", Timeout: time.Second})
	if err := sender.Send(context.Background(), user.MailMessage{To: "person@example.com", Subject: "Verify email", Text: "Hello\nhttps://app.example.com/verify-email#token=secret", HTML: `<p>Hello</p><a href="https://app.example.com/verify-email#token=secret">Verify</a>`}); err != nil {
		t.Fatal(err)
	}
	select {
	case message := <-messages:
		if !strings.Contains(message, "Subject: Verify email\r\n") || !strings.Contains(message, "#token=secret") {
			t.Fatalf("bad message: %s", message)
		}
		parsed, err := mail.ReadMessage(strings.NewReader(message))
		if err != nil {
			t.Fatal(err)
		}
		contentType, params, err := mime.ParseMediaType(parsed.Header.Get("Content-Type"))
		if err != nil || contentType != "multipart/alternative" {
			t.Fatalf("expected multipart alternative, got %s", contentType)
		}
		parts := multipart.NewReader(parsed.Body, params["boundary"])
		for _, expected := range []string{"text/plain", "text/html"} {
			part, err := parts.NextPart()
			if err != nil {
				t.Fatal(err)
			}
			if !strings.HasPrefix(part.Header.Get("Content-Type"), expected) {
				t.Fatalf("unexpected part: %v", part.Header)
			}
			body, err := io.ReadAll(part)
			if err != nil || !strings.Contains(string(body), "#token=secret") {
				t.Fatal("missing link in MIME part")
			}
		}
		if _, err := parts.NextPart(); err != io.EOF {
			t.Fatalf("unexpected extra part: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("no message")
	}
}

func TestSMTPRejectsInjection(t *testing.T) {
	for _, msg := range []user.MailMessage{
		{To: "a@example.com\r\nBcc: attacker@example.com", Subject: "test"},
		{To: "a@example.com", Subject: "test\r\nBcc: attacker@example.com"},
		{To: "", Subject: "test"},
	} {
		if err := New(Options{From: "care@example.com"}).Send(context.Background(), msg); err == nil {
			t.Fatal("expected rejection")
		}
	}
}

func TestSMTPTimeout(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	done := make(chan struct{})
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			<-done
		}
	}()
	defer close(done)
	sender := New(Options{Address: listener.Addr().String(), Host: "localhost", From: "care@example.com", Timeout: 30 * time.Millisecond})
	start := time.Now()
	if err := sender.Send(context.Background(), user.MailMessage{To: "person@example.com", Subject: "test"}); err == nil {
		t.Fatal("expected timeout")
	}
	if time.Since(start) > time.Second {
		t.Fatal("SMTP timeout was not bounded")
	}
}

func TestSMTPFailurePaths(t *testing.T) {
	for _, failure := range []string{"greeting", "tls", "unsafe auth", "auth", "MAIL", "RCPT", "DATA", "body"} {
		t.Run(failure, func(t *testing.T) {
			listener, err := net.Listen("tcp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			go func() {
				conn, err := listener.Accept()
				if err != nil {
					return
				}
				defer conn.Close()
				_ = conn.SetDeadline(time.Now().Add(time.Second))
				if failure == "greeting" {
					_, _ = io.WriteString(conn, "550 unavailable\r\n")
					return
				}
				_, _ = io.WriteString(conn, "220 localhost SMTP\r\n")
				reader := bufio.NewReader(conn)
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					switch {
					case strings.HasPrefix(line, "EHLO"):
						_, _ = io.WriteString(conn, "250 localhost\r\n")
					case strings.HasPrefix(line, failure):
						_, _ = io.WriteString(conn, "550 rejected\r\n")
					case strings.HasPrefix(line, "DATA"):
						_, _ = io.WriteString(conn, "354 continue\r\n")
						for {
							line, err = reader.ReadString('\n')
							if err != nil {
								return
							}
							if line == ".\r\n" {
								break
							}
						}
						_, _ = io.WriteString(conn, "550 rejected\r\n")
					default:
						_, _ = io.WriteString(conn, "250 ok\r\n")
					}
				}
			}()
			options := Options{Address: listener.Addr().String(), Host: "localhost", From: "care@example.com", Timeout: time.Second}
			if failure == "tls" || failure == "auth" {
				options.StartTLS = true
			}
			if failure == "unsafe auth" || failure == "auth" {
				options.Username = "user"
				options.Password = "password"
			}
			if err := New(options).Send(context.Background(), user.MailMessage{To: "person@example.com", Subject: "test"}); err == nil {
				t.Fatal("expected SMTP failure")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := New(Options{Address: "127.0.0.1:1", From: "care@example.com"}).Send(ctx, user.MailMessage{To: "person@example.com"}); err == nil {
		t.Fatal("expected canceled dial to fail")
	}
}
