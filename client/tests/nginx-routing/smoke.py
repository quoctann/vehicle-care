#!/usr/bin/env python3
"""Real production nginx routing smoke test; requires Python 3 and Docker."""

import argparse
import http.server
import ipaddress
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid


NGINX_IMAGE = "nginxinc/nginx-unprivileged:1.29-alpine"
UPSTREAM_IMAGE = "python:3.13-alpine"
SPA = b"<!doctype html><title>routing smoke SPA</title>"
ASSET = b"/* routing smoke asset */"
COOKIE = "sid=smoke-session; csrf_token=smoke-csrf"
CSRF = "smoke-csrf"
RESPONSE_COOKIE = "sid=smoke-refreshed; Path=/; HttpOnly; SameSite=Lax"


class Upstream(http.server.BaseHTTPRequestHandler):
    """Disposable echo fixture, not an application/auth implementation."""

    def do_GET(self):
        if self.path.startswith("/auth/google/callback?") and "fail_upstream=1" in self.path:
            self.close_connection = True
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        payload = json.dumps({
            "fixture": "routing-upstream",
            "method": self.command,
            "path": self.path,
            "body": body.decode("utf-8"),
            "http_version": self.request_version,
            "headers": dict(self.headers),
        }).encode()
        self.send_response(207)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", RESPONSE_COOKIE)
        self.send_header("X-Smoke-Upstream", "passed")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    do_POST = do_GET

    def log_message(self, *_args):
        pass


def docker(*args, timeout=120):
    return subprocess.run(
        ["docker", *args], check=True, text=True, capture_output=True,
        timeout=timeout,
    ).stdout.strip()


def request(base_url, path, method="GET", body=None):
    req = urllib.request.Request(
        base_url + path, data=body, method=method,
        headers={
            "Host": "routing-smoke.invalid",
            "Cookie": COOKIE,
            "X-CSRF-Token": CSRF,
            "X-Forwarded-For": "198.51.100.42",
            "Content-Type": "application/json",
        },
    )
    # Do not send local test traffic through environment-configured HTTP proxies.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        response = opener.open(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, response.headers, response.read()


def check_proxy(base_url, path, method="GET", body=None):
    status, headers, response = request(base_url, path, method, body)
    assert status == 207, f"{method} {path}: expected upstream 207, got {status}: {response!r}"
    assert headers.get_content_type() == "application/json"
    assert headers["Set-Cookie"] == RESPONSE_COOKIE
    assert headers["X-Smoke-Upstream"] == "passed"
    echoed = json.loads(response)
    assert echoed["fixture"] == "routing-upstream"
    assert echoed["method"] == method
    assert echoed["path"] == path, "proxy must preserve the full path and query"
    assert echoed["body"] == (body or b"").decode()
    assert echoed["http_version"] == "HTTP/1.1"
    forwarded = {key.lower(): value for key, value in echoed["headers"].items()}
    assert forwarded["cookie"] == COOKIE
    assert forwarded["x-csrf-token"] == CSRF
    assert forwarded["content-type"] == "application/json"
    assert forwarded["host"] == "routing-smoke.invalid"
    assert forwarded["x-forwarded-proto"] == "http"
    ipaddress.ip_address(forwarded["x-real-ip"])
    assert forwarded["x-forwarded-for"] == "198.51.100.42, " + forwarded["x-real-ip"]
    print(f"PASS {method} {path}: upstream status/JSON/cookie and request forwarding")


def check_routes(base_url):
    check_proxy(
        base_url, "/account/timezone", "POST",
        b'{"timezone":"UTC+07:00","expected_account_id":"smoke-account"}',
    )
    check_proxy(base_url, "/account/timezone?probe=preserve%2Bquery")
    check_proxy(base_url, "/auth/session")
    check_proxy(base_url, "/auth/google/callback?code=secret-google-code&state=secret-google-state")
    check_proxy(base_url, "/auth/login", "POST", b'{"email":"smoke@example.invalid"}')
    check_proxy(base_url, "/devices/register", "POST", b'{"device_id":"smoke-device"}')
    check_proxy(base_url, "/sync/push", "POST", b'{"mutations":[]}')
    check_proxy(base_url, "/sync/pull?after_seq=0&limit=100")

    for path in ("/", "/settings", "/settings?tab=account"):
        status, headers, body = request(base_url, path)
        assert status == 200 and body == SPA, f"{path}: SPA fallback changed"
        assert headers.get_content_type() == "text/html"
    status, headers, body = request(base_url, "/assets/smoke.js")
    assert status == 200 and body == ASSET, "existing asset must be served unchanged"
    cache_control = ", ".join(headers.get_all("Cache-Control", []))
    assert "immutable" in cache_control, f"missing immutable cache directive: {cache_control}"
    assert "max-age=31536000" in cache_control, f"missing one-year cache: {cache_control}"
    assert headers.get("Expires"), "existing asset must retain Expires header"
    status, _, body = request(base_url, "/assets/missing.js")
    assert status == 404 and body != SPA, "missing assets must not return the SPA"
    status, _, body = request(base_url, "/healthz")
    assert status == 200 and body == b"ok"
    print("PASS SPA fallback, static assets/cache headers, missing asset 404, healthz")


def wait_ready(base_url):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            status, _, body = request(base_url, "/auth/session")
            if status == 207 and json.loads(body)["fixture"] == "routing-upstream":
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    raise RuntimeError("nginx/upstream did not become ready within 10 seconds")


def smoke(config):
    docker("info", timeout=20)
    for image in (NGINX_IMAGE, UPSTREAM_IMAGE):
        try:
            docker("image", "inspect", image)
        except subprocess.CalledProcessError:
            print(f"Pulling prerequisite image {image}", flush=True)
            docker("pull", image, timeout=180)

    suffix = uuid.uuid4().hex
    network = "routing-smoke-" + suffix
    containers = []
    docker("network", "create", network)
    try:
        # Only this directory and uniquely named containers/network are disposable.
        temp_root = Path(os.environ.get("TMPDIR", "/tmp/opencode"))
        temp_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="nginx-routing-", dir=temp_root) as directory:
            root = Path(directory)
            root.chmod(0o755)  # nginx runs as uid 101, not the host user.
            assets = root / "assets"
            assets.mkdir()
            assets.chmod(0o755)
            (root / "index.html").write_bytes(SPA)
            (root / "assets/smoke.js").write_bytes(ASSET)
            for file in (root / "index.html", root / "assets/smoke.js"):
                file.chmod(0o644)

            upstream = "routing-upstream-" + suffix
            containers.append(upstream)
            docker(
                "run", "--detach", "--name", upstream, "--network", network,
                "--network-alias", "vehicle-care-backend",
                "--mount", f"type=bind,src={Path(__file__).resolve()},dst=/smoke.py,readonly",
                UPSTREAM_IMAGE, "python", "/smoke.py", "--upstream",
            )
            nginx = "routing-nginx-" + suffix
            containers.append(nginx)
            docker(
                "run", "--detach", "--name", nginx, "--network", network,
                "--publish", "127.0.0.1::8080",
                "--mount", f"type=bind,src={config},dst=/etc/nginx/conf.d/default.conf,readonly",
                "--mount", f"type=bind,src={root},dst=/usr/share/nginx/html,readonly",
                NGINX_IMAGE,
            )
            docker("exec", nginx, "nginx", "-t")
            print("PASS nginx -t")
            port = docker("port", nginx, "8080/tcp").rsplit(":", 1)[1]
            base_url = "http://127.0.0.1:" + port
            wait_ready(base_url)
            check_routes(base_url)
            status, _, _ = request(
                base_url,
                "/auth/google/callback?fail_upstream=1&code=secret-google-code&state=secret-google-state",
            )
            assert status == 502, "fixture must exercise an upstream failure"
            log_result = subprocess.run(
                ["docker", "logs", nginx], check=True, text=True, capture_output=True,
                timeout=20,
            )
            logs = log_result.stdout + log_result.stderr
            assert "/auth/session" in logs, "access log must be enabled for the control request"
            assert "secret-google-code" not in logs and "secret-google-state" not in logs, "OAuth credentials must not appear in access or error logs"
            print("PASS Google callback query excluded from nginx access/error logs, including upstream failure")
    finally:
        for container in reversed(containers):
            subprocess.run(["docker", "rm", "--force", container], capture_output=True)
        subprocess.run(["docker", "network", "rm", network], capture_output=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument(
        "--config", type=Path,
        help="nginx server config to mount unchanged (default: client/nginx.conf)",
    )
    args = parser.parse_args()
    if args.upstream:
        http.server.ThreadingHTTPServer(("0.0.0.0", 8080), Upstream).serve_forever()
    else:
        signal.signal(signal.SIGTERM, lambda *_args: sys.exit(143))
        config = args.config or Path(__file__).resolve().parents[2] / "nginx.conf"
        smoke(config.resolve(strict=True))


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError):
            print(error.stderr, file=sys.stderr)
        sys.exit(1)
