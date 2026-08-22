package main

import (
	"context"
	"database/sql"
	"log"
	"os"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/local/pdf-web-studio/apps/api/internal/config"
	"github.com/local/pdf-web-studio/apps/api/migrations"
	"github.com/pressly/goose/v3"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}
	db := sql.OpenDB(stdlib.GetConnector(mustParseConfig(cfg.DatabaseURL)))
	defer db.Close()
	goose.SetBaseFS(migrations.FS)
	if err := goose.SetDialect("postgres"); err != nil {
		log.Fatal(err)
	}
	command := "up"
	if len(os.Args) > 1 {
		command = os.Args[1]
	}
	if err := goose.RunContext(context.Background(), command, db, "."); err != nil {
		log.Fatalf("goose %s: %v", command, err)
	}
}

func mustParseConfig(databaseURL string) pgx.ConnConfig {
	parsed, err := pgx.ParseConfig(databaseURL)
	if err != nil {
		log.Fatalf("parse DATABASE_URL: %v", err)
	}
	return *parsed
}
