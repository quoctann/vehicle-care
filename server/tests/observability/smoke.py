#!/usr/bin/env python3
"""Disposable real-backend LGTM smoke test; Python standard library only."""

import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request


SERVER = Path(__file__).resolve().parents[2]
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("mail_smoke", SERVER / "tests/mail-flow/smoke.py")
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
Failure, require = helpers.Failure, helpers.require
command, wait_until = helpers.command, helpers.wait_until


class HTTP:
    def __init__(self, port):
        self.base = "http://127.0.0.1:" + str(port)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def request(self, path, headers=None):
        request = urllib.request.Request(self.base + path, headers=headers or {})
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            return response.status, dict(response.headers), raw

    def json(self, path):
        status, _, raw = self.request(path)
        if status != 200:
            return None
        return json.loads(raw)


def no_secrets(value, sensitive):
    serialized = json.dumps(value)
    require(not any(secret in serialized for secret in sensitive),
            "Sensitive request data appeared in exported telemetry.")


def log_records(path):
    if not path.exists():
        return []
    records = []
    for line in path.read_text().splitlines():
        try:
            records.append(json.loads(line))
        except ValueError:
            # The running process may still be writing its last line.
            continue
    return records


def exercise(api, prometheus, tempo, loki, logfile):
    started = time.time_ns()
    replies = [api.request("/auth/session") for _ in range(3)]
    require([reply[0] for reply in replies] == [401, 401, 429],
            "Expected session burst statuses 401, 401, 429.")
    body = json.loads(replies[-1][2]).get("error", {})
    require(body.get("retryable") is True and body.get("code") == "rate_limited",
            "Rate-limit response must be retryable with rate_limited code.")
    retry = next((value for key, value in replies[-1][1].items()
                  if key.lower() == "retry-after"), "")
    require(retry.isdigit() and int(retry) > 0, "Missing positive Retry-After.")
    for _ in range(3):
        require(api.request("/health/live")[0] == 200, "Liveness was rate limited.")
        require(api.request("/health/ready")[0] == 200, "Readiness was rate limited.")
    print("PASS: real Redis limiter burst, retryable 429, Retry-After, exempt health")

    # Wait for the actual limiter refill, not an arbitrary telemetry flush delay.
    time.sleep(int(retry))
    trace_id, span_id = secrets.token_hex(16), secrets.token_hex(8)
    sensitive = ["oauth-code-" + secrets.token_hex(16), "oauth-state-" + secrets.token_hex(16)]
    path = "/smoke-unknown/" + sensitive[0] + "?" + urllib.parse.urlencode(
        {"code": sensitive[0], "state": sensitive[1]})
    require(api.request(path, {"traceparent": "00-" + trace_id + "-" + span_id + "-01"})[0] == 404,
            "Unknown-route redaction probe did not reach the real router.")

    def metrics_exported():
        query = '{__name__=~"(vehicle.*|http_server_.*)",http_route="/auth/session",http_response_status_code="429"}'
        data = prometheus.json("/api/v1/query?" + urllib.parse.urlencode({"query": query}))
        no_secrets(data, sensitive)
        results = data.get("data", {}).get("result", []) if data else []
        if not results:
            return False
        names = {item["metric"]["__name__"] for item in results}
        require("http_server_request_count_total" in names,
                "Dashboard counter name differs from exported metrics: " + str(sorted(names)))
        require("http_server_request_duration_seconds_bucket" in names,
                "Dashboard histogram name differs from exported metrics: " + str(sorted(names)))
        return data.get("status") == "success" and any(float(item["value"][1]) > 0 for item in results)

    wait_until(metrics_exported, "OTLP HTTP metrics in Prometheus", timeout=120)
    print("PASS: nonzero rate-limit HTTP metrics exported before API shutdown")

    def trace_exported():
        data = tempo.json("/api/traces/" + trace_id)
        no_secrets(data, sensitive)
        return bool(data and (data.get("batches") or data.get("resourceSpans")))

    wait_until(trace_exported, "request trace in Tempo", timeout=120)
    records = log_records(logfile)
    no_secrets(records, sensitive)
    require(any(item.get("trace_id") == trace_id and item.get("span_id") for item in records),
            "Local JSON access log lacks propagated trace/span correlation.")
    print("PASS: request trace in Tempo and correlated, redacted JSON access log")

    def logs_exported():
        params = {"query": '{service_name="vehicle-care-smoke"}', "start": str(started),
                  "end": str(time.time_ns()), "limit": "1000"}
        data = loki.json("/loki/api/v1/query_range?" + urllib.parse.urlencode(params))
        no_secrets(data, sensitive)
        if not data or data.get("status") != "success":
            return False
        values = [value for stream in data.get("data", {}).get("result", [])
                  for value in stream.get("values", [])]
        return any(trace_id in value[1] for value in values)

    wait_until(logs_exported, "Alloy-collected trace-correlated logs in Loki", timeout=120)
    print("PASS: Alloy shipped redacted trace-correlated logs to Loki")


def run(resources, work):
    for executable in ("docker", "go"):
        require(shutil.which(executable) is not None, "Missing prerequisite: " + executable + ".")
    command(["docker", "info"], timeout=15)
    images = ("postgres:16-alpine", "redis:7-alpine", "grafana/otel-lgtm:0.29.0",
              "grafana/alloy:v1.14.0")
    for image in images:
        # Pull only missing images; an external image pull may already be complete.
        if subprocess.run(["docker", "image", "inspect", image], stdout=subprocess.DEVNULL,
                          stderr=subprocess.DEVNULL, timeout=15).returncode:
            command(["docker", "pull", image], timeout=600)
    resources.network = resources.tag
    command(["docker", "network", "create", "--label", "mail-smoke=" + resources.tag, resources.tag])
    password = secrets.token_hex(24)
    pg, pg_ports = resources.container("postgres", images[0], [5432], options=[
        "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=smoke",
        "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=smoke"])
    redis, redis_ports = resources.container("redis", images[1], [6379],
        args=["redis-server", "--appendonly", "no", "--save", ""])
    _, lgtm_ports = resources.container("lgtm", images[2], [3200, 9090, 3100, 4318],
        options=["--network-alias", "lgtm"])
    logs = work / "logs"
    logs.mkdir(mode=0o755)
    # Mount only the log directory, never the temp API binary or database secrets.
    work.chmod(0o755)
    logfile = logs / "api.json"
    logfile.touch(mode=0o644)
    resources.container("alloy", images[3], [], options=[
        "-e", "OTEL_SERVICE_NAME=vehicle-care-smoke", "-e", "APP_ENV=development",
        "--mount", "type=bind,src=" + str(logs) + ",dst=/logs,readonly",
        "--mount", "type=bind,src=" + str(SERVER / "observability/config.alloy")
        + ",dst=/etc/alloy/config.alloy,readonly"],
        args=["run", "--storage.path=/tmp/alloy", "/etc/alloy/config.alloy"])

    def ready_command(args):
        return subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=5).returncode == 0

    wait_until(lambda: ready_command(["docker", "exec", pg, "pg_isready", "-U", "smoke", "-d", "smoke"]),
               "PostgreSQL")
    wait_until(lambda: ready_command(["docker", "exec", redis, "redis-cli", "ping"]), "Redis")
    prometheus, tempo, loki = (HTTP(lgtm_ports[port]) for port in (9090, 3200, 3100))
    for client, route, name in ((prometheus, "/-/ready", "Prometheus"),
                                (tempo, "/ready", "Tempo"), (loki, "/ready", "Loki")):
        wait_until(lambda c=client, r=route: c.request(r)[0] == 200, name, timeout=180)
    print("Building and starting the real Go API; command/server output suppressed...")
    binary = str(work / "api")
    command(["go", "build", "-o", binary, "./cmd/api"], cwd=SERVER, timeout=300)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        api_port = reservation.getsockname()[1]
    # A nested working directory prevents .env and ../.env loading from the repo.
    cwd = work / "run"
    cwd.mkdir()
    blocked = ("DB_", "REDIS_", "SMTP_", "MAIL_", "GOOGLE_", "HTTP_", "COOKIE_", "FRONTEND_",
               "SYNC_", "OTEL_", "API_RATE_", "LOG_", "SESSION_", "AUTO_MIGRATE", "TRUSTED_PROXIES")
    environment = {key: value for key, value in os.environ.items() if not key.startswith(blocked)}
    environment.update({
        "APP_ENV": "development", "HTTP_HOST": "127.0.0.1", "HTTP_PORT": str(api_port),
        "DB_HOST": "127.0.0.1", "DB_PORT": str(pg_ports[5432]), "DB_USER": "smoke",
        "DB_PASSWORD": password, "DB_NAME": "smoke", "DB_SSLMODE": "disable",
        "REDIS_ADDR": "127.0.0.1:" + str(redis_ports[6379]), "REDIS_PASSWORD": "",
        "REDIS_DB": "0", "REDIS_TLS_ENABLED": "false", "AUTO_MIGRATE": "true",
        "COOKIE_SECURE": "false", "COOKIE_DOMAIN": "", "GOOGLE_OAUTH_ENABLED": "false",
        "FRONTEND_ORIGIN": helpers.FRONTEND, "FRONTEND_REDIRECT_URL": helpers.FRONTEND,
        "TRUSTED_PROXIES": "", "MAIL_FRONTEND_URL": helpers.FRONTEND,
        "SMTP_FROM": "noreply@example.test", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "1025",
        "SMTP_STARTTLS": "false", "SMTP_TIMEOUT": "5s", "SMTP_USERNAME": "", "SMTP_PASSWORD": "",
        "OTEL_ENABLED": "true", "OTEL_SERVICE_NAME": "vehicle-care-smoke",
        "OTEL_TRACE_SAMPLE_RATIO": "1",
        "OTEL_EXPORTER_OTLP_ENDPOINT": "http://127.0.0.1:" + str(lgtm_ports[4318]),
        "OTEL_METRIC_EXPORT_INTERVAL": "1000", "LOG_FILE": str(logfile),
        "API_RATE_LIMIT_PER_MINUTE": "600", "API_RATE_LIMIT_BURST": "2",
    })
    resources.api = subprocess.Popen([binary], cwd=cwd, env=environment,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    api = HTTP(api_port)

    def api_ready():
        require(resources.api.poll() is None, "API exited at startup; server output suppressed.")
        return api.request("/health/ready")[0] == 200

    wait_until(api_ready, "API readiness including migrations")
    exercise(api, prometheus, tempo, loki, logfile)


def main():
    resources = helpers.Resources()
    status = 0

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        Path("/tmp/opencode").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="vehicle-observability-smoke-", dir="/tmp/opencode") as directory:
            try:
                run(resources, Path(directory))
            finally:
                if not resources.close():
                    status = 1
                    print("FAIL: Some owned Docker resources could not be cleaned up.", file=sys.stderr)
    except Failure as error:
        print("FAIL: " + str(error), file=sys.stderr)
        status = 1
    except KeyboardInterrupt:
        print("FAIL: Interrupted; cleanup attempted.", file=sys.stderr)
        status = 130
    except Exception:
        print("FAIL: Unexpected smoke-test error; sensitive details suppressed.", file=sys.stderr)
        status = 1
    if status == 0:
        print("PASS: real backend LGTM smoke; disposable resources cleaned up")
    return status


if __name__ == "__main__":
    sys.exit(main())
