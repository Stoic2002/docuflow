package documents

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"strings"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

type ProtectionOptions struct {
	Password     string
	Printing     bool
	Copying      bool
	Modification bool
	Annotation   bool
	FormFilling  bool
	Assembly     bool
}

func randomOwnerPassword() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (s *Service) Protect(ctx context.Context, documentID uuid.UUID, options ProtectionOptions) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	ownerPassword, err := randomOwnerPassword()
	if err != nil {
		return Document{}, Version{}, err
	}
	metadata := map[string]any{"printing": options.Printing, "copying": options.Copying, "modification": options.Modification, "annotation": options.Annotation, "formFilling": options.FormFilling, "assembly": options.Assembly, "encryption": "AES-256", "beforeBytes": parent.ByteSize}
	return s.execute(ctx, document, parent, "protect", metadata, false, func(output string) (string, []string, error) {
		args, err := processing.QPDFProtectArgs(input, output, options.Password, ownerPassword, options.Printing, options.Copying, options.Modification, options.Annotation, options.FormFilling, options.Assembly)
		return "qpdf", args, err
	})
}

func (s *Service) Unlock(ctx context.Context, documentID uuid.UUID, password string) (Document, Version, error) {
	if len(password) > 128 {
		return Document{}, Version{}, ErrInvalidPassword
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	status, statusErr := processing.RunAndCapture(ctx, "qpdf", []string{"--show-encryption", "--password=" + password, input})
	if statusErr != nil {
		return Document{}, Version{}, ErrInvalidPassword
	}
	if strings.Contains(strings.ToLower(status), "incorrect password") {
		return Document{}, Version{}, ErrInvalidPassword
	}
	if strings.Contains(status, "File is not encrypted") {
		return Document{}, Version{}, ErrPDFNotEncrypted
	}
	if signed, checkErr := processing.QPDFHasSignaturesWithPassword(ctx, input, password); checkErr != nil {
		return Document{}, Version{}, checkErr
	} else if signed && !signatureConfirmed(ctx) {
		return Document{}, Version{}, ErrSignatureConfirmation
	}
	return s.execute(ctx, document, parent, "unlock", map[string]any{"beforeBytes": parent.ByteSize}, false, func(output string) (string, []string, error) {
		return "qpdf", processing.QPDFUnlockArgs(input, output, password), nil
	})
}
