package documents

import (
	"context"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

type signatureConfirmationKey struct{}

func WithSignatureConfirmation(ctx context.Context, confirmed bool) context.Context {
	return context.WithValue(ctx, signatureConfirmationKey{}, confirmed)
}
func signatureConfirmed(ctx context.Context) bool {
	value, _ := ctx.Value(signatureConfirmationKey{}).(bool)
	return value
}

func (s *Service) HasSignatures(ctx context.Context, documentID uuid.UUID) (bool, error) {
	_, _, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return false, err
	}
	return processing.QPDFHasSignatures(ctx, input)
}
