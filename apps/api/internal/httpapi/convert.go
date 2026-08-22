package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

const maxJPEGFiles = 20

func (s *Server) convertJPGToPDF(w http.ResponseWriter, r *http.Request) {
	if !s.databaseAvailable(r.Context()) || !s.storage.Writable() {
		writeError(w, http.StatusServiceUnavailable, "CONVERSION_UNAVAILABLE", "JPG to PDF requires the database and local storage", nil)
		return
	}
	images, cleanup, ok := s.readJPEGMultipart(w, r)
	if !ok {
		return
	}
	defer cleanup()
	document, version, err := s.documents.ConvertJPEGsToPDF(r.Context(), images)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	result := directToolResult(document, version)
	result["outputName"] = "converted-images.pdf"
	writeJSON(w, http.StatusCreated, result)
}

func (s *Server) readJPEGMultipart(w http.ResponseWriter, r *http.Request) ([]processing.JPEGInput, func(), bool) {
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Expected a multipart JPG upload", nil)
		return nil, func() {}, false
	}
	images := make([]processing.JPEGInput, 0, maxJPEGFiles)
	cleanup := func() {
		for _, image := range images {
			_ = os.Remove(image.Path)
		}
	}
	for {
		part, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			cleanup()
			s.writeJPEGMultipartError(w, nextErr)
			return nil, func() {}, false
		}
		if part.FileName() == "" {
			_, fieldErr := io.Copy(io.Discard, io.LimitReader(part, maxDirectFieldBytes+1))
			_ = part.Close()
			if fieldErr != nil {
				cleanup()
				s.writeJPEGMultipartError(w, fieldErr)
				return nil, func() {}, false
			}
			continue
		}
		if part.FormName() != "file" && part.FormName() != "files" && part.FormName() != "files[]" {
			_ = part.Close()
			cleanup()
			writeError(w, http.StatusBadRequest, "UNEXPECTED_FILE_FIELD", "JPG files must use the file field", nil)
			return nil, func() {}, false
		}
		if len(images) >= maxJPEGFiles {
			_ = part.Close()
			cleanup()
			writeError(w, http.StatusBadRequest, "TOO_MANY_FILES", fmt.Sprintf("Choose no more than %d JPG files", maxJPEGFiles), nil)
			return nil, func() {}, false
		}
		image, consumeErr := s.consumeJPEGPart(part)
		_ = part.Close()
		if consumeErr != nil {
			cleanup()
			s.writeJPEGMultipartError(w, consumeErr)
			return nil, func() {}, false
		}
		images = append(images, image)
	}
	if len(images) == 0 {
		cleanup()
		writeError(w, http.StatusBadRequest, "FILE_REQUIRED", "Choose one or more JPG files", nil)
		return nil, func() {}, false
	}
	return images, cleanup, true
}

func (s *Server) consumeJPEGPart(part *multipart.Part) (processing.JPEGInput, error) {
	name, err := validateJPEGMetadata(part.FileName(), part.Header.Get("Content-Type"))
	if err != nil {
		return processing.JPEGInput{}, err
	}
	temporary, err := s.storage.CreateTemp("convert-jpg-*.jpg")
	if err != nil {
		return processing.JPEGInput{}, fmt.Errorf("create JPEG temporary file: %w", err)
	}
	path := temporary.Name()
	committed := false
	defer func() {
		_ = temporary.Close()
		if !committed {
			_ = os.Remove(path)
		}
	}()
	byteSize, err := io.Copy(temporary, io.LimitReader(part, s.config.MaxUploadBytes+1))
	if err != nil {
		return processing.JPEGInput{}, fmt.Errorf("stream JPEG upload: %w", err)
	}
	if byteSize > s.config.MaxUploadBytes {
		return processing.JPEGInput{}, documentsTooLargeError{}
	}
	if err := temporary.Sync(); err != nil {
		return processing.JPEGInput{}, fmt.Errorf("sync JPEG upload: %w", err)
	}
	image, err := processing.InspectJPEG(path, name, byteSize)
	if err != nil {
		return processing.JPEGInput{}, err
	}
	committed = true
	return image, nil
}

type documentsTooLargeError struct{}

func (documentsTooLargeError) Error() string { return "JPEG exceeds configured size limit" }

func validateJPEGMetadata(filename, contentType string) (string, error) {
	filename = strings.ReplaceAll(filename, "\\", "/")
	name := filepath.Base(filename)
	extension := strings.ToLower(filepath.Ext(name))
	if name == "." || name == "" || strings.ContainsAny(name, "\r\n") || (extension != ".jpg" && extension != ".jpeg") {
		return "", processing.ErrInvalidJPEG
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || (mediaType != "image/jpeg" && mediaType != "application/octet-stream") {
		return "", processing.ErrInvalidJPEG
	}
	return name, nil
}

func (s *Server) writeJPEGMultipartError(w http.ResponseWriter, err error) {
	var maxBytesError *http.MaxBytesError
	var tooLarge documentsTooLargeError
	switch {
	case errors.As(err, &maxBytesError), errors.As(err, &tooLarge):
		writeError(w, http.StatusRequestEntityTooLarge, "UPLOAD_TOO_LARGE", "A JPG exceeds the configured size limit", map[string]any{"maxBytesPerFile": s.config.MaxUploadBytes})
	case errors.Is(err, processing.ErrJPEGDimensions):
		writeError(w, http.StatusBadRequest, "JPEG_DIMENSIONS_TOO_LARGE", "A JPG has unsafe pixel dimensions", nil)
	case errors.Is(err, processing.ErrInvalidJPEG):
		writeError(w, http.StatusBadRequest, "INVALID_JPEG", "Choose valid JPG or JPEG images", nil)
	default:
		writeError(w, http.StatusInternalServerError, "CONVERSION_INPUT_FAILED", "The JPG upload could not be prepared", nil)
	}
}
