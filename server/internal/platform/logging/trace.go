package logging

import (
	"context"

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
)

// ContextFields returns only explicitly approved correlation fields. Never add
// account, session, email, IP, baggage or raw request values here.
func ContextFields(ctx context.Context) []zap.Field {
	var fields []zap.Field
	if id := RequestID(ctx); id != "" {
		fields = append(fields, zap.String("request_id", id))
	}
	if sc := trace.SpanContextFromContext(ctx); sc.IsValid() {
		fields = append(fields,
			zap.String("trace_id", sc.TraceID().String()),
			zap.String("span_id", sc.SpanID().String()),
		)
	}
	return fields
}
