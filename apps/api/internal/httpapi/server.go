package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/local/pdf-web-studio/apps/api/internal/config"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
	"github.com/local/pdf-web-studio/apps/api/internal/storage"
)

type Server struct {
	config    config.Config
	pool      *pgxpool.Pool
	storage   *storage.Store
	detector  *processing.Detector
	documents *documents.Service
	fonts     *processing.FontRegistry
}

func New(cfg config.Config, pool *pgxpool.Pool, store *storage.Store, detector *processing.Detector) http.Handler {
	fonts := processing.LoadFontRegistry(cfg.FontDir)
	documentService := documents.NewService(documents.NewRepository(pool), store, cfg.MaxUploadBytes, fonts)
	server := &Server{config: cfg, pool: pool, storage: store, detector: detector, documents: documentService, fonts: fonts}
	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(server.requestLogger)
	router.Use(server.recoverer)
	router.Use(server.cors)
	router.Use(server.bodyLimit)
	router.Use(server.timeout)
	router.Get("/api/health", server.health)
	router.Get("/api/capabilities", server.capabilities)
	router.Get("/api/fonts", server.listFonts)
	router.Route("/api/edit-sessions", func(router chi.Router) {
		router.Post("/", server.createEditSession)
		router.Get("/{sessionId}", server.getEditSession)
		router.Post("/{sessionId}/export", server.exportEditSession)
	})
	router.Route("/api/documents", func(router chi.Router) {
		router.Get("/", server.listDocuments)
		router.Post("/", server.uploadDocument)
		router.Get("/trash", server.listTrash)
		router.Route("/{documentId}", func(router chi.Router) {
			router.Get("/", server.getDocument)
			router.Patch("/", server.renameDocument)
			router.Delete("/", server.deleteDocument)
			router.Post("/restore", server.restoreDocument)
			router.Delete("/permanent", server.permanentlyDeleteDocument)
			router.Get("/content", server.getDocumentContent)
			router.Get("/versions", server.listDocumentVersions)
			router.Get("/versions/{versionId}/content", server.getDocumentVersionContent)
			router.Get("/fonts", server.getDocumentFonts)
			router.Get("/metadata", server.getDocumentMetadata)
			router.Patch("/metadata", server.updateDocumentMetadata)
			router.Get("/pages/{page}/thumbnail", server.getPageThumbnail)
		})
	})
	router.Route("/api/tools", func(router chi.Router) {
		router.Post("/merge", server.mergeDocuments)
		router.Post("/split", server.splitDocument)
		router.Post("/extract", server.extractDocument)
		router.Post("/rotate", server.rotateDocument)
		router.Post("/reorder", server.reorderDocument)
		router.Post("/delete-pages", server.deleteDocumentPages)
		router.Post("/duplicate-pages", server.duplicateDocumentPages)
		router.Post("/insert-pages", server.insertDocumentPages)
		router.Post("/insert-blank-page", server.insertBlankPage)
		router.Post("/protect", server.protectDocument)
		router.Post("/unlock", server.unlockDocument)
		router.Post("/watermark", server.watermarkDocument)
		router.Post("/page-numbers", server.addPageNumbers)
		router.Post("/header-footer", server.addHeaderFooter)
		router.Post("/compress", server.compressDocument)
		router.Post("/ocr", server.ocrDocument)
		router.Post("/convert/jpg-to-pdf", server.convertJPGToPDF)
	})
	return router
}

func (s *Server) databaseAvailable(ctx context.Context) bool {
	// A remote PostgreSQL-compatible connection (for example Supabase's pooler)
	// can need more than two seconds for a cold TLS connection.
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.pool.Ping(ctx) == nil
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	databaseUp := s.databaseAvailable(r.Context())
	storageUp := s.storage.Writable()
	status := "ok"
	if !databaseUp || !storageUp {
		status = "degraded"
	}
	databaseStatus := "down"
	if databaseUp {
		databaseStatus = "up"
	}
	storageStatus := "down"
	if storageUp {
		storageStatus = "up"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status": status, "database": databaseStatus, "storage": storageStatus, "time": time.Now().UTC(),
	})
}

func (s *Server) capabilities(w http.ResponseWriter, r *http.Request) {
	tools := s.detector.Detect()
	availableFonts := s.fonts.Available()
	databaseUp := s.databaseAvailable(r.Context())
	storageUp := s.storage.Writable()
	baseAvailable := databaseUp && storageUp
	qpdfAvailable := tools.QPDF.Available && baseAvailable
	overlayAvailable := qpdfAvailable && tools.PDFInfo.Available
	ocrAvailable := tools.OCRmyPDF.Available && baseAvailable
	writeJSON(w, http.StatusOK, map[string]any{
		"storage":  map[string]bool{"available": storageUp},
		"database": map[string]bool{"available": databaseUp},
		"tools": map[string]any{
			"qpdf": tools.QPDF, "ocrmypdf": tools.OCRmyPDF, "pdfinfo": tools.PDFInfo,
			"pdftoppm": tools.PDFToPPM, "pdffonts": tools.PDFFonts,
		},
		"features": map[string]bool{
			"upload": baseAvailable, "view": baseAvailable,
			"pageOperations": qpdfAvailable,
			"compression":    qpdfAvailable,
			"searchableOcr":  ocrAvailable,
			"nativeEditing":  false,
			"organize":       qpdfAvailable,
			"protect":        qpdfAvailable,
			"unlock":         qpdfAvailable,
			"watermark":      overlayAvailable,
			"pageNumbers":    overlayAvailable,
			"headerFooter":   overlayAvailable,
			"annotate":       overlayAvailable,
			"metadata":       qpdfAvailable,
			"rename":         baseAvailable,
			"thumbnails":     tools.PDFToPPM.Available && baseAvailable,
			"embeddedFonts":  len(availableFonts) > 0,
			"fontScan":       tools.PDFFonts.Available,
		},
		"viewer":                    baseAvailable,
		"nativeContentEditing":      false,
		"overlayEditing":            overlayAvailable,
		"merge":                     qpdfAvailable,
		"split":                     qpdfAvailable,
		"compressLossless":          qpdfAvailable,
		"compressAdvanced":          false,
		"ocrSearchable":             ocrAvailable,
		"ocrEditableReconstruction": false,
		"convertPdfToImage":         false,
		"convertImageToPdf":         baseAvailable,
		"limits":                    map[string]int64{"maxUploadBytes": s.config.MaxUploadBytes},
	})
}

// getDocumentFonts reports the typefaces a PDF already carries, paired by the
// client against the registry so a missing one can be named precisely.
func (s *Server) getDocumentFonts(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "documentId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DOCUMENT_ID", "Document ID is invalid", nil)
		return
	}
	if !s.requireTool(w, "pdffonts") {
		return
	}
	fonts, err := s.documents.DocumentFonts(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	if fonts == nil {
		fonts = []processing.DocumentFont{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"fonts": fonts})
}

// listFonts exposes the embeddable fonts an editor may offer, plus the files
// the registry refused so the reason is visible instead of silent.
func (s *Server) listFonts(w http.ResponseWriter, r *http.Request) {
	fonts := s.fonts.Available()
	if fonts == nil {
		fonts = []processing.RegisteredFont{}
	}
	issues := s.fonts.Issues()
	if issues == nil {
		issues = []processing.FontIssue{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"fonts": fonts, "issues": issues})
}
