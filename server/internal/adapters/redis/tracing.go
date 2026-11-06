package redis

import (
	"context"
	"errors"
	"strings"

	goredis "github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// tracingHook records only bounded operation metadata, never command arguments,
// keys, addresses or error text. It holds no provider, allowing late setup.
type tracingHook struct{}

var _ goredis.Hook = tracingHook{}

// Dial is deliberately uninstrumented: logical commands own the client spans.
func (tracingHook) DialHook(next goredis.DialHook) goredis.DialHook { return next }

func (tracingHook) ProcessHook(next goredis.ProcessHook) goredis.ProcessHook {
	return func(ctx context.Context, cmd goredis.Cmder) error {
		attrs := []attribute.KeyValue{attribute.String("db.system.name", "redis")}
		if command := boundedCommand(cmd.Name()); command != "" {
			attrs = append(attrs, attribute.String("db.operation.name", command))
		}
		ctx, span := otel.Tracer("vehicle-care/redis").Start(ctx, "redis.command",
			trace.WithSpanKind(trace.SpanKindClient), trace.WithAttributes(attrs...))
		defer span.End()
		err := next(ctx, cmd)
		setDependencyStatus(span, err)
		return err
	}
}

func (tracingHook) ProcessPipelineHook(next goredis.ProcessPipelineHook) goredis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []goredis.Cmder) error {
		ctx, span := otel.Tracer("vehicle-care/redis").Start(ctx, "redis.pipeline",
			trace.WithSpanKind(trace.SpanKindClient),
			trace.WithAttributes(attribute.String("db.system.name", "redis")))
		defer span.End()
		err := next(ctx, cmds)
		setDependencyStatus(span, err)
		return err
	}
}

func setDependencyStatus(span trace.Span, err error) {
	if err != nil && !errors.Is(err, goredis.Nil) {
		span.SetStatus(codes.Error, "")
	}
}

func boundedCommand(name string) string {
	switch command := strings.ToUpper(name); command {
	case "GET", "SET", "DEL", "EXISTS", "EXPIRE", "TTL", "INCR", "PING", "EVAL", "EVALSHA", "SCRIPT", "MULTI", "EXEC":
		return command
	default:
		return ""
	}
}
