package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	APIAddr           string
	DatabaseURL       string
	FrontendOrigin    string
	StorageRoot       string
	FontDir           string
	MaxUploadBytes    int64
	RequestTimeout    time.Duration
	ProcessingTimeout time.Duration
}

func Load() (Config, error) {
	// Loading is best-effort; production-style secret management is outside local MVP scope.
	_ = godotenv.Load("../../.env", ".env")

	maxUpload, err := parsePositiveInt64("MAX_UPLOAD_BYTES", 50*1024*1024)
	if err != nil {
		return Config{}, err
	}
	requestTimeout, err := parseDuration("REQUEST_TIMEOUT", 30*time.Second)
	if err != nil {
		return Config{}, err
	}
	processingTimeout, err := parseDuration("PROCESSING_TIMEOUT", 5*time.Minute)
	if err != nil {
		return Config{}, err
	}
	storageRoot := envOr("STORAGE_ROOT", "../../data")
	absStorage, err := filepath.Abs(storageRoot)
	if err != nil {
		return Config{}, fmt.Errorf("resolve STORAGE_ROOT: %w", err)
	}
	// Fonts are an optional deployment input. A missing directory simply means
	// the editor offers the built-in Helvetica only.
	absFonts, err := filepath.Abs(envOr("FONT_DIR", "../../assets/fonts"))
	if err != nil {
		return Config{}, fmt.Errorf("resolve FONT_DIR: %w", err)
	}
	return Config{
		APIAddr:           envOr("API_ADDR", "127.0.0.1:8080"),
		DatabaseURL:       envOr("DATABASE_URL", "postgres://localhost:5432/pdf_web_studio?sslmode=disable"),
		FrontendOrigin:    envOr("FRONTEND_ORIGIN", "http://localhost:5173"),
		StorageRoot:       absStorage,
		FontDir:           absFonts,
		MaxUploadBytes:    maxUpload,
		RequestTimeout:    requestTimeout,
		ProcessingTimeout: processingTimeout,
	}, nil
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func parsePositiveInt64(key string, fallback int64) (int64, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return value, nil
}

func parseDuration(key string, fallback time.Duration) (time.Duration, error) {
	raw := os.Getenv(key)
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		return 0, fmt.Errorf("%s must be a positive duration", key)
	}
	return value, nil
}
