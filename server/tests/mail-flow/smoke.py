#!/usr/bin/env python3
"""Real SMTP/auth smoke test. Python 3 stdlib only; see README.md."""

import html
import http.cookiejar
import json
import os
from pathlib import Path
import re
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
import uuid


FRONTEND = "http://localhost:5173"
SERVER = Path(__file__).resolve().parents[2]


class Failure(Exception):
    """Only fixed, non-sensitive diagnostic messages belong here."""


def require(condition, message):
    if not condition:
        raise Failure(message)


def command(args, *, timeout=60, **kwargs):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, **kwargs)
    except (OSError, subprocess.TimeoutExpired):
        raise Failure("A prerequisite command failed or timed out; output suppressed.") from None
    require(result.returncode == 0, "A prerequisite command failed; output suppressed.")
    return result.stdout.decode().strip()


class HTTP:
    def __init__(self, base):
        self.base = base
        self.cookies = http.cookiejar.CookieJar()
        # Never send local smoke traffic through an inherited HTTP proxy.
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPCookieProcessor(self.cookies),
        )

    def request(self, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        request = urllib.request.Request(
            self.base + path, data=data,
            headers={"Content-Type": "application/json", "Origin": FRONTEND},
        )
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            raw = response.read()
            body = json.loads(raw) if raw else None
            return response.status, body

    def expect(self, path, payload=None, status=200):
        actual, body = self.request(path, payload)
        require(actual == status, "Unexpected HTTP status for " + path
                + ": expected " + str(status) + ", received " + str(actual) + ".")
        return body

    def cookie_snapshot(self):
        return sorted((cookie.name, cookie.value) for cookie in self.cookies)


def wait_until(check, description, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise Failure("Timed out waiting for " + description + ".")


def mail_token(message, expected_path, recipient):
    require(any(item.get("Address") == recipient for item in message.get("To", [])),
            "Delivered mail has an unexpected recipient.")
    text = html.unescape(message.get("Text", ""))
    links = re.findall(r"https?://[^\s<>\"']+", text)
    matching = [urllib.parse.urlsplit(link) for link in links
                if urllib.parse.urlsplit(link).path == expected_path]
    require(len(matching) == 1, "Mail must contain exactly one expected action link.")
    link = matching[0]
    require(link.scheme + "://" + link.netloc == FRONTEND,
            "Mail action link does not use the configured frontend origin.")
    require(not link.query and not link.username and not link.password,
            "Mail action link leaks credentials outside its fragment.")
    fragment = urllib.parse.parse_qs(link.fragment, strict_parsing=True)
    require(set(fragment) == {"token"} and len(fragment["token"]) == 1
            and bool(fragment["token"][0]), "Mail action fragment is invalid.")
    return fragment["token"][0]


class Resources:
    def __init__(self):
        self.tag = "vehicle-mail-smoke-" + uuid.uuid4().hex
        self.containers = []
        self.network = None
        self.api = None

    def container(self, role, image, ports, options=(), args=()):
        name = self.tag + "-" + role
        # Register before create, so interruption cannot orphan a created container.
        self.containers.append(name)
        publish = [item for port in ports for item in ("-p", "127.0.0.1::" + str(port))]
        command(["docker", "create", "--name", name, "--label", "mail-smoke=" + self.tag,
                 "--network", self.tag, *publish, *options, image, *args])
        command(["docker", "start", name])
        bindings = json.loads(command(["docker", "inspect", "--format",
                                       "{{json .NetworkSettings.Ports}}", name]))
        return name, {port: int(bindings[str(port) + "/tcp"][0]["HostPort"])
                      for port in ports}

    def close(self):
        ok = True
        if self.api is not None:
            self.api.terminate()
            try:
                self.api.wait(timeout=12)
            except subprocess.TimeoutExpired:
                self.api.kill()
                self.api.wait()
        for name in reversed(self.containers):
            try:
                label = command(["docker", "inspect", "--format",
                                 '{{index .Config.Labels "mail-smoke"}}', name])
                if label == self.tag:
                    command(["docker", "rm", "-f", "-v", name])
            except Failure:
                ok = False
        if self.network:
            try:
                label = command(["docker", "network", "inspect", "--format",
                                 '{{index .Labels "mail-smoke"}}', self.network])
                if label == self.tag:
                    command(["docker", "network", "rm", self.network])
            except Failure:
                ok = False
        return ok


def mail_ids(mailpit):
    result = mailpit.expect("/api/v1/messages")
    return {message["ID"] for message in result.get("messages", [])}


def next_mail(mailpit, before, path, recipient):
    wait_until(lambda: len(mail_ids(mailpit) - before) == 1, "SMTP delivery", timeout=20)
    new_ids = mail_ids(mailpit) - before
    require(len(new_ids) == 1, "Expected exactly one delivered mail.")
    message = mailpit.expect("/api/v1/message/" + next(iter(new_ids)))
    return mail_token(message, path, recipient)


def exercise(api_url, mailpit):
    owner, second, unrelated, anonymous = (HTTP(api_url) for _ in range(4))
    email = "owner@example.test"
    old_password, new_password = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    before = mail_ids(mailpit)
    signup = owner.expect("/auth/signup", {"email": email, "password": old_password}, status=201)
    require("token" not in json.dumps(signup).lower(), "Signup exposed a token in JSON.")
    verification = next_mail(mailpit, before, "/verify-email", email)
    session = owner.expect("/auth/session")["account"]
    require(not session["email_verified"], "New account was already verified.")
    anonymous.expect("/auth/verify-email", {"token": verification})
    anonymous.expect("/auth/verify-email", {"token": verification}, status=400)
    require(owner.expect("/auth/session")["account"]["email_verified"],
            "Verification did not persist to PostgreSQL.")
    print("PASS: signup SMTP delivery, fragment link, one-time verification")

    before = mail_ids(mailpit)
    generic = anonymous.expect("/auth/verify-email/resend", {"email": email})
    missing = anonymous.expect("/auth/verify-email/resend", {"email": "missing@example.test"})
    forgot_missing = anonymous.expect("/auth/password/forgot", {"email": "missing@example.test"})
    require(generic == missing == forgot_missing, "Recovery responses disclose account existence.")
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        require(mail_ids(mailpit) == before, "No-op recovery request delivered extra mail.")
        time.sleep(0.2)
    print("PASS: verified/nonexistent resend and nonexistent forgot send no mail")

    second.expect("/auth/login", {"email": email, "password": old_password})
    require(owner.cookie_snapshot() != second.cookie_snapshot(), "Old sessions are not distinct.")
    second.expect("/auth/session")
    before = mail_ids(mailpit)
    unrelated.expect("/auth/signup", {"email": "other@example.test",
                                       "password": secrets.token_urlsafe(24)}, status=201)
    next_mail(mailpit, before, "/verify-email", "other@example.test")
    other_account = unrelated.expect("/auth/session")["account"]["id"]
    other_cookies = unrelated.cookie_snapshot()

    before = mail_ids(mailpit)
    response = anonymous.expect("/auth/password/forgot", {"email": email})
    require(response == forgot_missing, "Forgot responses disclose account existence.")
    reset = next_mail(mailpit, before, "/reset-password", email)
    # Deliberately reset A while carrying B's session: B must not be signed out.
    unrelated.expect("/auth/password/reset", {"token": reset, "new_password": new_password})
    require(unrelated.cookie_snapshot() == other_cookies,
            "Password reset changed an unrelated account's cookies.")
    require(unrelated.expect("/auth/session")["account"]["id"] == other_account,
            "Password reset invalidated an unrelated account's session.")
    owner.expect("/auth/session", status=401)
    second.expect("/auth/session", status=401)
    anonymous.expect("/auth/login", {"email": email, "password": old_password}, status=401)
    anonymous.expect("/auth/login", {"email": email, "password": new_password})
    anonymous.expect("/auth/password/reset", {"token": reset, "new_password": old_password}, status=400)
    HTTP(api_url).expect("/auth/login", {"email": email, "password": new_password})
    print("PASS: reset SMTP delivery, all old sessions revoked, unrelated session preserved,")
    print("      old password rejected, new password accepted, reset replay rejected")


def run(resources, work):
    for executable in ("docker", "go"):
        require(shutil.which(executable) is not None, "Missing prerequisite: " + executable + ".")
    command(["docker", "info"], timeout=15)
    print("Preparing disposable PostgreSQL, Redis and Mailpit containers...")
    for image in ("postgres:16-alpine", "redis:7-alpine", "axllent/mailpit:v1.27"):
        command(["docker", "image", "pull", image], timeout=180)
    # Unique names and no host mounts: existing databases/containers are never used.
    resources.network = resources.tag
    command(["docker", "network", "create", "--label", "mail-smoke=" + resources.tag, resources.tag])
    password = secrets.token_hex(24)
    pg, pg_ports = resources.container("postgres", "postgres:16-alpine", [5432], options=[
        "--tmpfs", "/var/lib/postgresql/data", "-e", "POSTGRES_USER=smoke",
        "-e", "POSTGRES_PASSWORD=" + password, "-e", "POSTGRES_DB=smoke"])
    redis, redis_ports = resources.container("redis", "redis:7-alpine", [6379],
        args=["redis-server", "--appendonly", "no", "--save", ""])
    _, mail_ports = resources.container("mailpit", "axllent/mailpit:v1.27", [1025, 8025])

    def ready_command(args):
        return subprocess.run(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              timeout=5).returncode == 0

    wait_until(lambda: ready_command(["docker", "exec", pg, "pg_isready", "-U", "smoke", "-d", "smoke"]),
               "PostgreSQL")
    wait_until(lambda: ready_command(["docker", "exec", redis, "redis-cli", "ping"]), "Redis")
    mailpit = HTTP("http://127.0.0.1:" + str(mail_ports[8025]))
    wait_until(lambda: mailpit.request("/api/v1/messages")[0] == 200, "Mailpit")
    binary = str(work / "api")
    print("Building the real Go API (compiler output suppressed)...")
    command(["go", "build", "-o", binary, "./cmd/api"], cwd=SERVER, timeout=240)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        api_port = reservation.getsockname()[1]
    # Run outside server/ so config.Load cannot read either existing .env file.
    blocked = ("DB_", "REDIS_", "SMTP_", "MAIL_", "GOOGLE_", "HTTP_", "COOKIE_", "FRONTEND_", "SYNC_")
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(blocked)}
    environment.update({
        "APP_ENV": "development", "HTTP_HOST": "127.0.0.1", "HTTP_PORT": str(api_port),
        "DB_HOST": "127.0.0.1", "DB_PORT": str(pg_ports[5432]), "DB_USER": "smoke",
        "DB_PASSWORD": password, "DB_NAME": "smoke", "DB_SSLMODE": "disable",
        "REDIS_ADDR": "127.0.0.1:" + str(redis_ports[6379]), "REDIS_PASSWORD": "",
        "REDIS_DB": "0", "REDIS_TLS_ENABLED": "false", "AUTO_MIGRATE": "true",
        "COOKIE_SECURE": "false", "COOKIE_DOMAIN": "", "GOOGLE_OAUTH_ENABLED": "false",
        "FRONTEND_ORIGIN": FRONTEND, "FRONTEND_REDIRECT_URL": FRONTEND, "TRUSTED_PROXIES": "",
        "MAIL_FRONTEND_URL": FRONTEND, "SMTP_FROM": "noreply@example.test",
        "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(mail_ports[1025]),
        "SMTP_STARTTLS": "false", "SMTP_TIMEOUT": "5s", "SMTP_USERNAME": "", "SMTP_PASSWORD": "",
    })
    resources.api = subprocess.Popen([binary], cwd=work, env=environment,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    api_url = "http://127.0.0.1:" + str(api_port)

    def api_ready():
        require(resources.api.poll() is None, "API exited at startup; server logs intentionally suppressed.")
        return HTTP(api_url).request("/health/ready")[0] == 200

    wait_until(api_ready, "API readiness (including migrations)")
    exercise(api_url, mailpit)


def main():
    resources = Resources()
    status = 0

    def interrupted(_signum, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        Path("/tmp/opencode").mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="vehicle-mail-smoke-", dir="/tmp/opencode") as directory:
            try:
                run(resources, Path(directory))
            finally:
                # Stop the API before TemporaryDirectory removes its binary.
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
        # Exception repr/tracebacks can include request URLs, bodies or credentials.
        print("FAIL: Unexpected smoke-test error; sensitive details suppressed.", file=sys.stderr)
        status = 1
    if status == 0:
        print("PASS: real backend mail flow; disposable resources cleaned up")
    return status


if __name__ == "__main__":
    sys.exit(main())
