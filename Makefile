SHELL := /bin/bash

.PHONY: help install dev dev-fe dev-be test test-fe test-be lint lint-fe lint-be build build-fe build-be \
	dev-infra dev-infra-down dev-infra-logs migrate-up migrate-down migrate-status migrate-create

help:
	@printf '%s\n' \
		'make install        Install frontend and backend dependencies' \
		'make dev            Run frontend and backend together' \
		'make dev-fe         Run Vite on http://localhost:5173 (talks to the real backend)' \
		'make dev-be         Run the Go API on http://localhost:8080' \
		'make dev-infra      Start Postgres + Redis (required by the API)' \
		'make dev-infra-down Stop Postgres + Redis' \
		'make migrate-up     Apply database migrations (needs DB_HOST/DB_USER/DB_PASSWORD/DB_NAME)' \
		'make migrate-create name=<name>  Scaffold a new timestamp-prefixed migration pair' \
		'make test           Run all tests' \
		'make lint           Run frontend lint and Go vet' \
		'make build          Build frontend and backend'

install:
	npm ci --prefix client
	cd server && go mod download

dev:
	@set -m; \
	trap 'kill -- -$$BE_PID -$$FE_PID 2>/dev/null || true' EXIT INT TERM; \
	$(MAKE) --no-print-directory dev-be & BE_PID=$$!; \
	$(MAKE) --no-print-directory dev-fe & FE_PID=$$!; \
	wait -n $$BE_PID $$FE_PID

dev-fe:
	VITE_API_BASE_URL=http://localhost:8080 npm run dev --prefix client

dev-be:
	cd server && go run ./cmd/api

dev-infra:
	docker compose -f server/docker-compose.yml up -d

dev-infra-down:
	docker compose -f server/docker-compose.yml down

dev-infra-logs:
	docker compose -f server/docker-compose.yml logs -f

migrate-up:
	cd server && go run ./cmd/migrate up

migrate-down:
	cd server && go run ./cmd/migrate down

migrate-status:
	cd server && go run ./cmd/migrate status

migrate-create:
	@if [ -z "$(name)" ]; then echo "Usage: make migrate-create name=<migration_name>"; exit 1; fi
	cd server && go run ./cmd/migrate create "$(name)"

test: test-fe test-be

test-fe:
	npm run test --prefix client

test-be:
	cd server && go test -race ./...

lint: lint-fe lint-be

lint-fe:
	npm run lint --prefix client

lint-be:
	cd server && go vet ./...

build: build-fe build-be

build-fe:
	npm run build --prefix client

build-be:
	cd server && go build ./...
