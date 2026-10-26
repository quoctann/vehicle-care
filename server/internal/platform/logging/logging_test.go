package logging

import (
	"context"
	"go.opentelemetry.io/otel/trace"
	"testing"
)

func TestContextFields(t *testing.T) {
	if len(ContextFields(context.Background())) != 0 {
		t.Fatal("unexpected empty context fields")
	}
	ctx := WithRequestID(context.Background(), "req_safe")
	ctx = trace.ContextWithSpanContext(ctx, trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{1}, SpanID: trace.SpanID{1}, TraceFlags: trace.FlagsSampled,
	}))
	fields := ContextFields(ctx)
	if len(fields) != 3 || fields[0].Key != "request_id" || fields[1].Key != "trace_id" || fields[2].Key != "span_id" {
		t.Fatalf("fields=%v", fields)
	}
}

func TestNewJSONStdout(t *testing.T) {
	for _, environment := range []string{"production", "development"} {
		logger, err := New(environment)
		if err != nil || logger == nil {
			t.Fatalf("logger=%v err=%v", logger, err)
		}
	}
}
