package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestTelemetryPrivacyPropagationAndRecovery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	exp := tracetest.NewInMemoryExporter()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(exp))
	reader := sdkmetric.NewManualReader()
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader))
	oldTP, oldMP, oldProp := otel.GetTracerProvider(), otel.GetMeterProvider(), otel.GetTextMapPropagator()
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.TraceContext{})
	t.Cleanup(func() {
		_ = tp.Shutdown(context.Background())
		_ = mp.Shutdown(context.Background())
		otel.SetTracerProvider(oldTP)
		otel.SetMeterProvider(oldMP)
		otel.SetTextMapPropagator(oldProp)
	})
	core, logs := observer.New(zap.InfoLevel)
	s := &Server{logger: zap.New(core)}
	r := gin.New()
	r.Use(s.requestID(), s.telemetry(), s.accessLog(), s.recovery())
	r.GET("/auth/google/callback", func(c *gin.Context) { c.Status(400) })
	r.GET("/vehicles/:id", func(c *gin.Context) { c.Status(200) })
	r.GET("/panic", func(c *gin.Context) { panic("private-email@example.com SQL password") })
	r.GET("/health/live", func(c *gin.Context) { c.Status(200) })
	r.OPTIONS("/vehicles/:id", func(c *gin.Context) { c.Status(204) })
	for _, item := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/auth/google/callback?code=oauth-secret&state=private-state", 400},
		{"GET", "/vehicles/private-vehicle?token=private-token", 200},
		{"GET", "/unknown-private-email@example.com", 404},
		{"GET", "/panic", 500},
		{"GET", "/health/live", 200},
		{"OPTIONS", "/vehicles/private-vehicle", 204},
	} {
		req := httptest.NewRequest(item.method, item.path, nil)
		req.Header.Set("traceparent", "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01")
		req.Header.Set("Cookie", "sid=private-session")
		req.Header.Set("X-Request-ID", "req_test")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != item.status {
			t.Fatalf("%s status=%d", item.path, w.Code)
		}
	}
	spans := exp.GetSpans()
	if len(spans) != 4 {
		t.Fatalf("spans=%d", len(spans))
	}
	for i, name := range []string{"GET /auth/google/callback", "GET /vehicles/:id", "GET unmatched", "GET /panic"} {
		if spans[i].Name != name || spans[i].SpanKind != trace.SpanKindServer {
			t.Errorf("span=%+v", spans[i])
		}
		if spans[i].Parent.SpanID().String() != "0123456789abcdef" || spans[i].SpanContext.TraceID().String() != "0123456789abcdef0123456789abcdef" {
			t.Error("missing parent propagation")
		}
	}
	if spans[3].Status.Code != codes.Error {
		t.Error("panic not error")
	}
	if spans[0].Status.Code == codes.Error {
		t.Error("client error marked as server error")
	}
	var data metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &data); err != nil {
		t.Fatal(err)
	}
	counts := int64(0)
	durations := uint64(0)
	active := int64(0)
	statuses := map[int64]int64{}
	for _, scope := range data.ScopeMetrics {
		for _, m := range scope.Metrics {
			switch d := m.Data.(type) {
			case metricdata.Sum[int64]:
				for _, p := range d.DataPoints {
					if m.Name == "http.server.request.count" {
						counts += p.Value
						for _, attr := range p.Attributes.ToSlice() {
							if attr.Key == "http.response.status_code" {
								statuses[attr.Value.AsInt64()] += p.Value
							}
							if attr.Key != "http.request.method" && attr.Key != "http.route" && attr.Key != "http.response.status_code" {
								t.Errorf("unapproved metric attribute %s", attr.Key)
							}
						}
					}
					if m.Name == "http.server.active_requests" {
						active += p.Value
					}
				}
			case metricdata.Histogram[float64]:
				for _, p := range d.DataPoints {
					durations += p.Count
				}
			}
		}
	}
	if counts != 4 || durations != 4 || active != 0 {
		t.Fatalf("counts=%d durations=%d active=%d", counts, durations, active)
	}
	for _, status := range []int64{200, 400, 404, 500} {
		if statuses[status] != 1 {
			t.Errorf("status %d count=%d", status, statuses[status])
		}
	}
	access := logs.FilterMessage("http request").All()
	if len(access) != 6 {
		t.Fatalf("access logs=%d", len(access))
	}
	if access[3].ContextMap()["status"] != int64(500) || access[3].ContextMap()["trace_id"] == nil || access[3].ContextMap()["request_id"] != "req_test" {
		t.Errorf("panic access log: %+v", access[3].ContextMap())
	}
	encoded, err := json.Marshal(struct {
		Spans   any
		Metrics any
		Logs    any
	}{spans, data, logs.All()})
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"oauth-secret", "private-state", "private-vehicle", "private-token", "unknown-private-email", "private-email", "private-session", "SQL password", "url.full", "url.query", "client.address"} {
		if strings.Contains(string(encoded), secret) {
			t.Errorf("telemetry leaked %q", secret)
		}
	}
}

func TestBoundedHTTPMethod(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, http.MethodHead, http.MethodOptions, http.MethodConnect, http.MethodTrace} {
		if boundedMethod(method) != method {
			t.Fatal(method)
		}
	}
	if boundedMethod("SECRET-METHOD") != "_OTHER" {
		t.Fatal("unbounded method")
	}
}
