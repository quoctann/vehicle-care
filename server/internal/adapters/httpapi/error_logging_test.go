package httpapi

import (
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	app "github.com/quoctann/vehicle-care/server/internal/application"
	"github.com/quoctann/vehicle-care/server/internal/platform/logging"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

func TestErrorLogsRedactDependencyAndUnknownCode(t *testing.T) {
	const secret = "private-token-email-sql"
	for _, err := range []error{
		errors.New(secret), fmt.Errorf("dependency: %w", errors.New(secret)),
		&app.Error{Code: secret, Message: secret},
	} {
		core, logs := observer.New(zap.ErrorLevel)
		s := &Server{logger: zap.New(core)}
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		c.Request = httptest.NewRequest("GET", "/", nil)
		c.Request = c.Request.WithContext(logging.WithRequestID(c.Request.Context(), "req_safe"))
		c.Set(requestIDKey, "req_safe")
		s.writeError(c, err)
		if response.Code != 500 || strings.Contains(response.Body.String(), secret) {
			t.Fatalf("unsafe error response: %s", response.Body.String())
		}
		if logs.Len() != 1 {
			t.Fatalf("logs=%d", logs.Len())
		}
		entry := logs.All()[0]
		if strings.Contains(fmt.Sprint(entry.ContextMap()), secret) || entry.ContextMap()["request_id"] != "req_safe" {
			t.Fatal("unsafe error log or missing correlation")
		}
	}
}
