# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
RUN go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

# distroless: no shell needed since /health/live and /health/ready are HTTP
# probes, and it runs as non-root by default (uid 65532), matching the
# runAsNonRoot + readOnlyRootFilesystem pod security used in infra.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/api /out/migrate /usr/local/bin/

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
