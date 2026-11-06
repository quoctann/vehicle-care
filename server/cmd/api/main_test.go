package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"testing"
	"time"

	"go.uber.org/zap"
)

func TestServeReturnsListenerFailure(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := serve(ctx, &http.Server{Addr: listener.Addr().String()}, zap.NewNop()); err == nil {
		t.Fatal("listener failure ignored")
	}
}

func TestServeHandlesPreCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := serve(ctx, &http.Server{Addr: "127.0.0.1:0"}, zap.NewNop()); err != nil {
		t.Fatal(err)
	}
}

func TestServeDrainsActiveRequest(t *testing.T) {
	reservation, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reservation.Addr().String()
	_ = reservation.Close()
	started, release := make(chan struct{}), make(chan struct{})
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	server := &http.Server{Addr: address, Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusNoContent)
	})}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- serve(ctx, server, zap.NewNop()) }()
	response := make(chan error, 1)
	go requestWhenListening(ctx, "http://"+address, response)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("request did not reach handler")
	}
	cancel()
	select {
	case err := <-done:
		t.Fatalf("returned before draining active request: %v", err)
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	if err := <-response; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func requestWhenListening(ctx context.Context, url string, result chan<- error) {
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		response, err := client.Get(url)
		if err == nil {
			_ = response.Body.Close()
			if response.StatusCode != http.StatusNoContent {
				result <- fmt.Errorf("status %d", response.StatusCode)
			} else {
				result <- nil
			}
			return
		}
		select {
		case <-ctx.Done():
			result <- err
			return
		case <-time.After(time.Millisecond):
		}
	}
}
