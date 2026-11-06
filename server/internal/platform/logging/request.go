package logging

import "context"

type requestIDContextKey struct{}

// WithRequestID only accepts the public correlation ID format, not arbitrary
// headers or sensitive request data. The HTTP adapter generates missing IDs.
func WithRequestID(ctx context.Context, id string) context.Context {
	if len(id) == 0 || len(id) > 64 {
		return ctx
	}
	for _, char := range id {
		if !(char >= 'a' && char <= 'z') && !(char >= 'A' && char <= 'Z') && !(char >= '0' && char <= '9') && char != '-' && char != '_' {
			return ctx
		}
	}
	return context.WithValue(ctx, requestIDContextKey{}, id)
}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDContextKey{}).(string)
	return id
}
