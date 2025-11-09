FROM golang:1.22-alpine AS build
WORKDIR /app
COPY file-management/slides/service/go.mod ./go.mod
COPY file-management/slides/service/go.sum ./go.sum
COPY shared/coreauth /shared/coreauth
RUN apk add --no-cache git
RUN go env -w GOPROXY=https://proxy.golang.org,direct && go mod download -x || true
COPY file-management/slides/service/ ./
RUN go mod tidy && go mod download -x || true
RUN mkdir -p /out \
 && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/berjis-slides ./cmd/service

FROM gcr.io/distroless/base-debian12
WORKDIR /
COPY --from=build /out/berjis-slides /berjis-slides
COPY --from=build /app/migrations /migrations
EXPOSE 8085
USER 65532:65532
ENTRYPOINT ["/berjis-slides"]
