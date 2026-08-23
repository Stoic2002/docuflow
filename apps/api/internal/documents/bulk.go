package documents

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

// MaxBulkDocuments caps one bulk request so a single call cannot tie the server
// up walking an unbounded list of documents.
const MaxBulkDocuments = 200

var (
	ErrNoDocumentsSelected = errors.New("no documents selected")
	ErrTooManyDocuments    = errors.New("too many documents in one request")
)

// BulkFailure records why one document in a bulk request was left alone.
type BulkFailure struct {
	DocumentID uuid.UUID
	Reason     error
}

// BulkResult is itemised on purpose: one document that has already gone must
// not hide the ones that were removed, and permanent deletion of the rest
// cannot simply be replayed.
type BulkResult struct {
	Deleted  []uuid.UUID
	Failures []BulkFailure
}

// DeleteMany moves several documents to Trash. Originals and versions stay on
// disk, so a failure part-way through leaves nothing to repair.
func (s *Service) DeleteMany(ctx context.Context, ids []uuid.UUID) (BulkResult, error) {
	return s.deleteEach(ctx, ids, s.Delete)
}

// PermanentDeleteMany purges several documents from Trash. Each document is
// staged and committed on its own, so the ones that succeed lose both rows and
// bytes while the ones that fail keep both.
func (s *Service) PermanentDeleteMany(ctx context.Context, ids []uuid.UUID) (BulkResult, error) {
	return s.deleteEach(ctx, ids, s.PermanentDelete)
}

func (s *Service) deleteEach(ctx context.Context, ids []uuid.UUID, remove func(context.Context, uuid.UUID) error) (BulkResult, error) {
	if len(ids) == 0 {
		return BulkResult{}, ErrNoDocumentsSelected
	}
	if len(ids) > MaxBulkDocuments {
		return BulkResult{}, ErrTooManyDocuments
	}
	result := BulkResult{Deleted: make([]uuid.UUID, 0, len(ids))}
	seen := make(map[uuid.UUID]struct{}, len(ids))
	for _, id := range ids {
		if _, repeated := seen[id]; repeated {
			continue
		}
		seen[id] = struct{}{}
		// An abandoned request stops the walk; whatever already committed stands.
		if err := ctx.Err(); err != nil {
			return result, err
		}
		if err := remove(ctx, id); err != nil {
			result.Failures = append(result.Failures, BulkFailure{DocumentID: id, Reason: err})
			continue
		}
		result.Deleted = append(result.Deleted, id)
	}
	return result, nil
}
