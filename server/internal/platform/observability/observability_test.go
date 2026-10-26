package observability

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	collectormetric "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

func TestDisabledInstallsNoopAndW3C(t *testing.T) {
	oldTP, oldMP, oldProp := otel.GetTracerProvider(), otel.GetMeterProvider(), otel.GetTextMapPropagator()
	defer func() {
		otel.SetTracerProvider(oldTP)
		otel.SetMeterProvider(oldMP)
		otel.SetTextMapPropagator(oldProp)
	}()
	exp := tracetest.NewInMemoryExporter()
	provider := trace.NewTracerProvider(trace.WithSyncer(exp))
	otel.SetTracerProvider(provider)
	shutdown, err := Init(context.Background(), Options{ServiceName: "test", TraceSampleRatio: 1})
	if err != nil {
		t.Fatal(err)
	}
	ctx := otel.GetTextMapPropagator().Extract(context.Background(), propagation.MapCarrier{"traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"})
	_, span := otel.Tracer("test").Start(ctx, "disabled")
	if span.IsRecording() {
		t.Fatal("disabled span recording")
	}
	span.End()
	if len(exp.GetSpans()) != 0 {
		t.Fatal("disabled exporter used")
	}
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestInitRejectsInvalidOptions(t *testing.T) {
	if _, err := Init(context.Background(), Options{Enabled: true, ServiceName: "test", TraceSampleRatio: 2}); err == nil {
		t.Fatal("invalid sample ratio accepted")
	}
}

func TestEnabledExportsOTLPHTTPUsingStandardEnvironment(t *testing.T) {
	var mu sync.Mutex
	payloads := map[string][]byte{}
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test" {
			t.Error("missing configured exporter header")
		}
		b, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		mu.Lock()
		payloads[r.URL.Path] = b
		mu.Unlock()
		w.Header().Set("Content-Type", "application/x-protobuf")
		w.WriteHeader(200)
	}))
	defer collector.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer%20test")
	oldTP, oldMP, oldProp := otel.GetTracerProvider(), otel.GetMeterProvider(), otel.GetTextMapPropagator()
	defer func() {
		otel.SetTracerProvider(oldTP)
		otel.SetMeterProvider(oldMP)
		otel.SetTextMapPropagator(oldProp)
	}()
	shutdown, err := Init(context.Background(), Options{Enabled: true, ServiceName: "vehicle-care-test", Environment: "test", Version: "v1", TraceSampleRatio: 1})
	if err != nil {
		t.Fatal(err)
	}
	ctx, span := otel.Tracer("test").Start(context.Background(), "safe operation")
	counter, err := otel.Meter("test").Int64Counter("test.count", metric.WithUnit("{request}"))
	if err != nil {
		t.Fatal(err)
	}
	counter.Add(ctx, 1)
	span.End()
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	var traces collectortrace.ExportTraceServiceRequest
	if err := proto.Unmarshal(payloads["/v1/traces"], &traces); err != nil {
		t.Fatal(err)
	}
	if len(traces.ResourceSpans) != 1 || len(traces.ResourceSpans[0].ScopeSpans[0].Spans) != 1 {
		t.Fatalf("missing traces: %v", &traces)
	}
	attrs := traces.ResourceSpans[0].Resource.Attributes
	if len(attrs) != 3 {
		t.Fatalf("unexpected resource attributes: %v", attrs)
	}
	resource := map[string]string{}
	for _, a := range attrs {
		resource[a.Key] = a.Value.GetStringValue()
	}
	if resource["service.name"] != "vehicle-care-test" || resource["service.version"] != "v1" || resource["deployment.environment.name"] != "test" {
		t.Fatal(resource)
	}
	var metrics collectormetric.ExportMetricsServiceRequest
	if err := proto.Unmarshal(payloads["/v1/metrics"], &metrics); err != nil {
		t.Fatal(err)
	}
	if len(metrics.ResourceMetrics) != 1 || metrics.ResourceMetrics[0].ScopeMetrics[0].Metrics[0].Name != "test.count" {
		t.Fatalf("missing metrics: %v", &metrics)
	}
}

func TestEnabledMinimalResourceAndZeroSampling(t *testing.T) {
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer collector.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
	oldTP, oldMP, oldProp := otel.GetTracerProvider(), otel.GetMeterProvider(), otel.GetTextMapPropagator()
	defer func() {
		otel.SetTracerProvider(oldTP)
		otel.SetMeterProvider(oldMP)
		otel.SetTextMapPropagator(oldProp)
	}()
	shutdown, err := Init(context.Background(), Options{Enabled: true, ServiceName: "test", TraceSampleRatio: 0})
	if err != nil {
		t.Fatal(err)
	}
	_, span := otel.Tracer("test").Start(context.Background(), "unsampled")
	if span.IsRecording() {
		t.Error("zero ratio sampled a span")
	}
	span.End()
	if err := shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
}
