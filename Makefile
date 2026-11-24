# Pure-Go build (no cgo). `nomsgpack` drops gin's msgpack codec, which is
# unused and expensive to compile.
GOFLAGS_BUILD := -tags nomsgpack -trimpath
VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo dev)
LDFLAGS := -s -w -X github.com/aimerneige/ai-image-workspace/internal/api.Version=$(VERSION)

.PHONY: all web build test dev-api dev-web mock docker clean

all: web build

web:
	cd web && npm ci && npm run build

build:
	CGO_ENABLED=0 go build $(GOFLAGS_BUILD) -ldflags "$(LDFLAGS)" -o bin/aiw ./cmd/server

test:
	go test -tags nomsgpack ./...
	cd web && npm run typecheck

# Backend on :8080; pair with `make dev-web` for hot-reloading UI on :5173.
dev-api:
	go run -tags nomsgpack ./cmd/server -config config.yaml

dev-web:
	cd web && npm run dev

# Fake OpenAI + Gemini upstream on :9090 for development without API keys.
mock:
	go run ./cmd/mock-upstream -addr :9090

docker:
	docker build --build-arg VERSION=$(VERSION) -t ai-image-workspace:$(VERSION) .

clean:
	rm -rf bin internal/webui/dist/assets internal/webui/dist/index.html internal/webui/dist/favicon.svg
