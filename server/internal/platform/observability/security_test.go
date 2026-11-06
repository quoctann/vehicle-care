package observability

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-logr/logr"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"
)

type diagnosticCapture struct {
	mu      sync.Mutex
	buffer  bytes.Buffer
	written chan struct{}
}

func (d *diagnosticCapture) Write(b []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	n, err := d.buffer.Write(b)
	select {
	case d.written <- struct{}{}:
	default:
	}
	return n, err
}
func (d *diagnosticCapture) String() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.buffer.String()
}

func TestExporterDiagnosticsNeverExposeCollectorData(t *testing.T) {
	for _, partial := range []bool{false, true} {
		t.Run(map[bool]string{false: "http-error", true: "partial-success"}[partial], func(t *testing.T) {
			capture := &diagnosticCapture{written: make(chan struct{}, 16)}
			oldOutput := log.Writer()
			log.SetOutput(capture)
			defer log.SetOutput(oldOutput)
			collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = io.Copy(io.Discard, r.Body)
				if partial {
					b, err := proto.Marshal(&collectortrace.ExportTraceServiceResponse{PartialSuccess: &collectortrace.ExportTracePartialSuccess{RejectedSpans: 1, ErrorMessage: "collector-response-body-secret"}})
					if err != nil {
						t.Error(err)
					}
					w.Header().Set("Content-Type", "application/x-protobuf")
					_, _ = w.Write(b)
				} else {
					w.WriteHeader(400)
					_, _ = w.Write([]byte("collector-response-body-secret"))
				}
			}))
			defer collector.Close()
			t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL+"/collector-url-secret")
			t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=collector-auth-secret")
			t.Setenv("OTEL_BSP_SCHEDULE_DELAY", "1")
			oldTP, oldMP := otel.GetTracerProvider(), otel.GetMeterProvider()
			defer func() { otel.SetTracerProvider(oldTP); otel.SetMeterProvider(oldMP) }()
			shutdown, err := Init(context.Background(), Options{Enabled: true, ServiceName: "test", TraceSampleRatio: 1})
			if err != nil {
				t.Fatal(err)
			}
			_, span := otel.Tracer("test").Start(context.Background(), "test")
			span.End()
			select {
			case <-capture.written:
			case <-time.After(5 * time.Second):
				t.Fatal("export failure diagnostic missing")
			}
			// Include returned flush errors: callers may log them, too.
			if err := shutdown(context.Background()); err != nil {
				log.Print(err)
			}
			output := capture.String()
			for _, canary := range []string{collector.URL, "collector-url-secret", "collector-response-body-secret", "collector-auth-secret"} {
				if strings.Contains(output, canary) {
					t.Errorf("diagnostic leaked %q: %s", canary, output)
				}
			}
			if !strings.Contains(output, "telemetry") {
				t.Errorf("missing fixed diagnostic: %s", output)
			}
		})
	}
}

func TestSDKDiagnosticsSanitizedBeforeExporterInitialization(t *testing.T) {
	var output bytes.Buffer
	oldOutput := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(oldOutput)
	t.Setenv("OTEL_EXPORTER_OTLP_HEADERS", "invalid-header-secret")
	oldTP, oldMP := otel.GetTracerProvider(), otel.GetMeterProvider()
	defer func() { otel.SetTracerProvider(oldTP); otel.SetMeterProvider(oldMP) }()
	shutdown, err := Init(context.Background(), Options{Enabled: true, ServiceName: "test", TraceSampleRatio: 0})
	if err != nil {
		log.Print(err)
	} else {
		_ = shutdown(context.Background())
	}
	otel.Handle(errors.New("raw-export-error-secret"))
	if strings.Contains(output.String(), "invalid-header-secret") || strings.Contains(output.String(), "raw-export-error-secret") {
		t.Fatalf("unsanitized SDK diagnostic: %s", output.String())
	}
	if !strings.Contains(output.String(), "telemetry") {
		t.Fatal("missing safe diagnostic")
	}
	if !strings.Contains(output.String(), "telemetry SDK diagnostic failed") {
		t.Fatal("exporter initialization did not use sanitized SDK diagnostic sink")
	}
}

func TestDiagnosticSinkDropsAllSDKFields(t *testing.T) {
	var output bytes.Buffer
	oldOutput := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(oldOutput)
	logger := logr.New(safeDiagnosticSink{}).WithName("name-secret").WithValues("key-secret", "value-secret")
	logger.Info("message-secret", "key-secret", "value-secret")
	logger.Error(errors.New("error-secret"), "message-secret", "key-secret", "value-secret")
	logger.V(1).Info("verbose-secret")
	if strings.Contains(output.String(), "secret") {
		t.Fatalf("SDK fields leaked: %s", output.String())
	}
	if strings.Count(output.String(), "telemetry SDK diagnostic") != 2 {
		t.Fatal("unexpected diagnostic filtering")
	}
}

func TestUntrustedRemoteParentsCannotOverrideSamplingRatio(t *testing.T) {
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	defer collector.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", collector.URL)
	oldTP, oldMP := otel.GetTracerProvider(), otel.GetMeterProvider()
	defer func() { otel.SetTracerProvider(oldTP); otel.SetMeterProvider(oldMP) }()
	for _, ratio := range []float64{0, 1} {
		shutdown, err := Init(context.Background(), Options{Enabled: true, ServiceName: "test", TraceSampleRatio: ratio})
		if err != nil {
			t.Fatal(err)
		}
		for _, flag := range []string{"00", "01"} {
			ctx := propagation.TraceContext{}.Extract(context.Background(), propagation.MapCarrier{"traceparent": "00-0123456789abcdef0123456789abcdef-0123456789abcdef-" + flag})
			_, span := otel.Tracer("test").Start(ctx, "remote child")
			if span.SpanContext().IsSampled() != (ratio == 1) {
				t.Errorf("ratio %v remote flag %s sampled=%v", ratio, flag, span.SpanContext().IsSampled())
			}
			span.End()
		}
		// Trusted, in-process parents retain the normal parent-based decision.
		for _, sampled := range []bool{false, true} {
			flags := trace.TraceFlags(0)
			if sampled {
				flags = trace.FlagsSampled
			}
			parent := trace.NewSpanContext(trace.SpanContextConfig{TraceID: trace.TraceID{1}, SpanID: trace.SpanID{1}, TraceFlags: flags})
			_, span := otel.Tracer("test").Start(trace.ContextWithSpanContext(context.Background(), parent), "local child")
			if span.SpanContext().IsSampled() != sampled {
				t.Error("local parent decision lost")
			}
			span.End()
		}
		if err := shutdown(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	// Disabled mode still rejects invalid sampling configuration.
	if _, err := Init(context.Background(), Options{Enabled: false, ServiceName: "test", TraceSampleRatio: 2}); err == nil {
		t.Fatal("disabled invalid config accepted")
	}
}
