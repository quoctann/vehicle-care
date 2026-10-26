package httpapi

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// Only registered templates enter telemetry; unmatched paths are never recorded.
func telemetryRoute(c *gin.Context) string {
	if route := c.FullPath(); route != "" {
		return route
	}
	return "unmatched"
}

func boundedMethod(method string) string {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodConnect, http.MethodOptions, http.MethodTrace:
		return method
	default:
		return "_OTHER"
	}
}

// telemetry must wrap accessLog and recovery so recovered panics have status 500
// before telemetry is finalized. No headers, URL, query, IDs or error text are
// exported as attributes. W3C TraceContext propagation deliberately omits baggage.
func (s *Server) telemetry() gin.HandlerFunc {
	meter := otel.Meter("vehicle-care/httpapi")
	count, _ := meter.Int64Counter("http.server.request.count", metric.WithUnit("{request}"))
	duration, _ := meter.Float64Histogram("http.server.request.duration", metric.WithUnit("s"),
		metric.WithExplicitBucketBoundaries(.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10))
	active, _ := meter.Int64UpDownCounter("http.server.active_requests", metric.WithUnit("{request}"))
	tracer := otel.Tracer("vehicle-care/httpapi")
	return func(c *gin.Context) {
		route := telemetryRoute(c)
		if route == "/health/live" || route == "/health/ready" || c.Request.Method == http.MethodOptions {
			c.Next()
			return
		}
		method := boundedMethod(c.Request.Method)
		attrs := []attribute.KeyValue{attribute.String("http.request.method", method), attribute.String("http.route", route)}
		ctx := otel.GetTextMapPropagator().Extract(c.Request.Context(), propagation.HeaderCarrier(c.Request.Header))
		ctx, span := tracer.Start(ctx, method+" "+route, trace.WithSpanKind(trace.SpanKindServer), trace.WithAttributes(attrs...))
		defer span.End()
		c.Request = c.Request.WithContext(ctx)
		started := time.Now()
		active.Add(ctx, 1, metric.WithAttributes(attrs...))
		c.Next()
		active.Add(ctx, -1, metric.WithAttributes(attrs...))
		status := c.Writer.Status()
		span.SetAttributes(attribute.Int("http.response.status_code", status))
		if status >= 500 {
			span.SetStatus(codes.Error, "server error")
		}
		finalAttrs := append(attrs, attribute.Int("http.response.status_code", status))
		count.Add(ctx, 1, metric.WithAttributes(finalAttrs...))
		duration.Record(ctx, time.Since(started).Seconds(), metric.WithAttributes(finalAttrs...))
	}
}
