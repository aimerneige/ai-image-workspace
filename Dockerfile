# syntax=docker/dockerfile:1

# ---- frontend -------------------------------------------------------------
FROM node:24-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN mkdir -p ../internal/webui/dist && npm run build

# ---- backend --------------------------------------------------------------
FROM golang:1.27-alpine AS build
WORKDIR /src
# Lower parallelism keeps the pure-Go SQLite driver build within small VMs.
ARG GOFLAGS="-p=2"
ENV CGO_ENABLED=0 GOFLAGS=${GOFLAGS}
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY --from=web /src/internal/webui/dist ./internal/webui/dist
ARG VERSION=dev
RUN go build -tags nomsgpack -trimpath \
      -ldflags "-s -w -X github.com/aimerneige/ai-image-workspace/internal/api.Version=${VERSION}" \
      -o /out/aiw ./cmd/server

# ---- runtime --------------------------------------------------------------
FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata \
 && adduser -D -H -u 10001 aiw \
 && mkdir -p /data /etc/aiw \
 && chown aiw:aiw /data
COPY --from=build /out/aiw /usr/local/bin/aiw
COPY deploy/config.docker.yaml /etc/aiw/config.yaml
ENV AIW_CONFIG=/etc/aiw/config.yaml
USER aiw
WORKDIR /data
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
ENTRYPOINT ["aiw"]
