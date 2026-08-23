.PHONY: setup generate migrate dev-api dev-web test test-go test-web build

setup:
	bun install
	cd apps/api && go mod download

generate:
	cd apps/api && go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.29.0 generate
	bun run --cwd apps/web generate-routes

migrate:
	cd apps/api && go run ./cmd/migrate up

dev-api:
	cd apps/api && go run ./cmd/api

dev-web:
	bun run dev

test: test-go test-web

test-go:
	cd apps/api && go test ./...

test-web:
	bun run typecheck
	bun run lint
	bun run test

build:
	cd apps/api && go build -o ./bin/pdf-web-studio-api ./cmd/api
	bun run build
