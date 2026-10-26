// Package observability configures privacy-safe OTLP/HTTP telemetry. Request
// instrumentation must supply only bounded operation names and attributes.
package observability

import (
	"context"
	"errors"
	"log"

	"github.com/go-logr/logr"
	"github.com/quoctann/vehicle-care/server/internal/platform/config"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	metricnoop "go.opentelemetry.io/otel/metric/noop"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	tracenoop "go.opentelemetry.io/otel/trace/noop"
)

type Options = config.Observability
type Shutdown func(context.Context) error

// Init installs process-wide providers. Initialize once, before constructing
// adapters. Disabled mode explicitly replaces any providers with no-ops.
// Resources deliberately exclude host/process/environment detectors: those can
// accidentally export credentials or machine-identifying information.
func Init(ctx context.Context, opts Options) (Shutdown, error) {
	if err := opts.Validate(); err != nil {
		return nil, err
	}
	// Both SDK configuration diagnostics and asynchronous export errors may
	// contain endpoints, headers or collector response bodies. Install the
	// fixed-message sinks before constructing any exporter, including disabled
	// mode, so no process-wide OTel diagnostic uses its unsafe default sink.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(error) { log.Print("telemetry export failed") }))
	otel.SetLogger(logr.New(safeDiagnosticSink{}))
	otel.SetTextMapPropagator(propagation.TraceContext{})
	if !opts.Enabled {
		otel.SetTracerProvider(tracenoop.NewTracerProvider())
		otel.SetMeterProvider(metricnoop.NewMeterProvider())
		return func(context.Context) error { return nil }, nil
	}
	attrs := []attribute.KeyValue{attribute.String("service.name", opts.ServiceName)}
	if opts.Environment != "" {
		attrs = append(attrs, attribute.String("deployment.environment.name", opts.Environment))
	}
	if opts.Version != "" {
		attrs = append(attrs, attribute.String("service.version", opts.Version))
	}
	res := resource.NewSchemaless(attrs...)
	traces, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, errors.New("initialize telemetry trace exporter failed")
	}
	metrics, err := otlpmetrichttp.New(ctx)
	if err != nil {
		_ = traces.Shutdown(ctx)
		return nil, errors.New("initialize telemetry metric exporter failed")
	}
	// Public W3C headers establish causality, not authority over sampling.
	// Ignore remote sampled flags while honoring trusted in-process parents.
	ratio := sdktrace.TraceIDRatioBased(opts.TraceSampleRatio)
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(traces), sdktrace.WithResource(res),
		sdktrace.WithSampler(sdktrace.ParentBased(ratio,
			sdktrace.WithRemoteParentSampled(ratio), sdktrace.WithRemoteParentNotSampled(ratio))))
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithResource(res), sdkmetric.WithReader(sdkmetric.NewPeriodicReader(metrics)))
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	return func(ctx context.Context) error {
		if errors.Join(tp.Shutdown(ctx), mp.Shutdown(ctx)) != nil {
			// Callers commonly log shutdown errors; do not return raw exporter data.
			return errors.New("telemetry shutdown failed")
		}
		return nil
	}, nil
}

// safeDiagnosticSink deliberately ignores SDK messages, errors, names and
// structured values; even apparently harmless SDK fields can contain secrets.
type safeDiagnosticSink struct{}

func (safeDiagnosticSink) Init(logr.RuntimeInfo)            {}
func (safeDiagnosticSink) Enabled(level int) bool           { return level <= 0 }
func (safeDiagnosticSink) Info(int, string, ...any)         { log.Print("telemetry SDK diagnostic") }
func (safeDiagnosticSink) Error(error, string, ...any)      { log.Print("telemetry SDK diagnostic failed") }
func (s safeDiagnosticSink) WithValues(...any) logr.LogSink { return s }
func (s safeDiagnosticSink) WithName(string) logr.LogSink   { return s }
