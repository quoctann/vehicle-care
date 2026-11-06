package postgres

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/quoctann/vehicle-care/server/internal/adapters/postgres/pgtest"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/noop"
)

func TestQueryTracingPrivacyAndParent(t *testing.T) {
	tracer := queryTracer{}
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous); _ = provider.Shutdown(context.Background()) })
	ctx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	for _, err := range []error{nil, errors.New("password=secret SQL SELECT private")} {
		child := tracer.TraceQueryStart(ctx, nil, pgx.TraceQueryStartData{SQL: "SELECT 'secret'", Args: []any{"private"}})
		if trace.SpanContextFromContext(child).SpanID() == parent.SpanContext().SpanID() {
			t.Fatal("query did not receive a child span")
		}
		tracer.TraceQueryEnd(child, nil, pgx.TraceQueryEndData{Err: err})
	}
	spans := exporter.GetSpans()
	if len(spans) != 2 {
		t.Fatalf("got %d spans", len(spans))
	}
	for i, span := range spans {
		if span.Name != "postgres.query" || span.SpanKind != trace.SpanKindClient || span.Parent.SpanID() != parent.SpanContext().SpanID() {
			t.Fatalf("invalid span identity: %+v", span)
		}
		if len(span.Attributes) != 1 || string(span.Attributes[0].Key) != "db.system.name" || span.Attributes[0].Value.AsString() != "postgresql" || len(span.Events) != 0 {
			t.Fatalf("unexpected telemetry data: %+v", span)
		}
		want := codes.Unset
		if i == 1 {
			want = codes.Error
		}
		if span.Status.Code != want || span.Status.Description != "" {
			t.Fatalf("unsafe status: %+v", span.Status)
		}
	}
	parent.End()
}

func TestQueryTracingNoop(t *testing.T) {
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(noop.NewTracerProvider())
	t.Cleanup(func() { otel.SetTracerProvider(previous) })
	tracer := queryTracer{}
	ctx := tracer.TraceQueryStart(context.Background(), nil, pgx.TraceQueryStartData{})
	tracer.TraceQueryEnd(ctx, nil, pgx.TraceQueryEndData{Err: errors.New("secret")})
}

func TestQueryTracingStoreIntegration(t *testing.T) {
	dsn := pgtest.StartDSN(t)
	// Construct the store before installing the provider to verify late setup.
	store, err := New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	exporter := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exporter))
	previous := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	t.Cleanup(func() { otel.SetTracerProvider(previous); _ = provider.Shutdown(context.Background()) })
	ctx, parent := provider.Tracer("test").Start(context.Background(), "parent")
	var value string
	if err := store.db.GetContext(ctx, &value, "SELECT $1::text", "private-value"); err != nil {
		t.Fatal(err)
	}
	if value != "private-value" {
		t.Fatal("query result changed")
	}
	spans := exporter.GetSpans()
	if len(spans) != 1 || spans[0].Name != "postgres.query" || spans[0].Parent.SpanID() != parent.SpanContext().SpanID() || len(spans[0].Attributes) != 1 {
		t.Fatalf("store query not safely traced: %+v", spans)
	}
	parent.End()
}
