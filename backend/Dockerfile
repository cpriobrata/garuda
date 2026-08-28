FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/garuda-api ./cmd/api

FROM alpine:3.22
RUN apk add --no-cache ca-certificates tzdata && addgroup -S garuda && adduser -S -G garuda garuda
WORKDIR /app
COPY --from=build /out/garuda-api /usr/local/bin/garuda-api
RUN mkdir -p /app/data && chown -R garuda:garuda /app
USER garuda
ENV GARUDA_ADDRESS=:8080 GARUDA_DATA_FILE=/app/data/garuda.json GARUDA_DEMO_MODE=false
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/garuda-api"]
