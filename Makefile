SHELL := /bin/bash

.PHONY: help install dev dev-fe dev-be test test-fe test-be lint lint-fe lint-be build build-fe build-be

help:
	@printf '%s\n' \
		'make install  Install frontend and backend dependencies' \
		'make dev      Run frontend and backend together' \
		'make dev-fe   Run Vite without MSW on http://localhost:5173' \
		'make dev-be   Run the Go API on http://localhost:8080' \
		'make test     Run all tests' \
		'make lint     Run frontend lint and Go vet' \
		'make build    Build frontend and backend'

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
	VITE_ENABLE_MSW=false VITE_API_BASE_URL=http://localhost:8080 npm run dev --prefix client

dev-be:
	cd server && go run ./cmd/api

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
