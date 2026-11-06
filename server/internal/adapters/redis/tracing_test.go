package redis

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"

	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

func TestDependencyTracingPrivacyAndParent(t *testing.T) {
	hook := tracingHook{}
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous); _ = provider.Shutdown(context.Background()) })
	ctx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	failure := errors.New("secret host password key")
	for _, tc := range []struct {
		name     string
		pipeline bool
		err      error
		command  string
	}{
		{"GET", false, nil, "GET"}, {"get", false, goredis.Nil, "GET"},
		{"GET", false, fmt.Errorf("private: %w", goredis.Nil), "GET"},
		{"secret-command", false, failure, ""}, {"SET", true, failure, ""},
		{"SET", true, goredis.Nil, ""}, {"SET", true, nil, ""},
	} {
		cmd := goredis.NewCmd(ctx, tc.name, "secret-key", "secret-value")
		checkContext := func(child context.Context) {
			if trace.SpanContextFromContext(child).SpanID() == parent.SpanContext().SpanID() {
				t.Fatal("missing child context")
			}
		}
		var err error
		if tc.pipeline {
			err = hook.ProcessPipelineHook(func(child context.Context, cmds []goredis.Cmder) error { checkContext(child); return tc.err })(ctx, []goredis.Cmder{cmd})
		} else {
			err = hook.ProcessHook(func(child context.Context, got goredis.Cmder) error {
				checkContext(child)
				if got != cmd {
					t.Fatal("command changed")
				}
				return tc.err
			})(ctx, cmd)
		}
		if err != tc.err {
			t.Fatal("error changed")
		}
		spans := exporter.GetSpans()
		span := spans[len(spans)-1]
		name := "redis.command"
		if tc.pipeline {
			name = "redis.pipeline"
		}
		if span.Name != name || span.SpanKind != trace.SpanKindClient || span.Parent.SpanID() != parent.SpanContext().SpanID() {
			t.Fatalf("invalid span: %+v", span)
		}
		wantAttrs := 1
		if tc.command != "" {
			wantAttrs++
		}
		if len(span.Attributes) != wantAttrs || len(span.Events) != 0 {
			t.Fatalf("unexpected telemetry data: %+v", span)
		}
		for _, attr := range span.Attributes {
			switch string(attr.Key) {
			case "db.system.name":
				if attr.Value.AsString() != "redis" {
					t.Fatal("wrong system")
				}
			case "db.operation.name":
				if attr.Value.AsString() != tc.command {
					t.Fatal("unbounded command")
				}
			default:
				t.Fatalf("unsafe attribute: %v", attr)
			}
		}
		wantStatus := codes.Unset
		if tc.err == failure {
			wantStatus = codes.Error
		}
		if span.Status.Code != wantStatus || span.Status.Description != "" {
			t.Fatalf("unsafe status: %+v", span.Status)
		}
	}
	if len(exporter.GetSpans()) != 7 {
		t.Fatal("wrong span count")
	}
	parent.End()
}

// terminalProcessHook short-circuits transport while preserving the real Redis
// client's hook chain, so registration is tested without contacting a server.
type terminalProcessHook struct{ tracingHook }

func (terminalProcessHook) ProcessHook(_ goredis.ProcessHook) goredis.ProcessHook {
	return func(context.Context, goredis.Cmder) error { return nil }
}

func TestDependencyTracingStoreRegistration(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous); _ = provider.Shutdown(context.Background()) })
	client := goredis.NewClient(&goredis.Options{})
	t.Cleanup(func() { _ = client.Close() })
	store := NewStore(client)
	client.AddHook(terminalProcessHook{})
	if err := store.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "redis.command" {
		t.Fatalf("store did not register tracing hook: %+v", spans)
	}
}

func TestDependencyTracingNoopAndDial(t *testing.T) {
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(noop.NewTracerProvider())
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	hook := tracingHook{}
	ctx := context.Background()
	cmd := goredis.NewCmd(ctx, "GET", "private")
	_ = hook.ProcessHook(func(context.Context, goredis.Cmder) error { return nil })(ctx, cmd)
	_ = hook.ProcessPipelineHook(func(context.Context, []goredis.Cmder) error { return nil })(ctx, nil)
	failure := errors.New("private address")
	_, err := hook.DialHook(func(got context.Context, network, addr string) (net.Conn, error) {
		if got != ctx || network != "tcp" || addr != "private" {
			t.Fatal("dial changed")
		}
		return nil, failure
	})(ctx, "tcp", "private")
	if err != failure {
		t.Fatal("dial error changed")
	}
}
