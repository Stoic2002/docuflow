package documents

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestDeleteEachRejectsAnEmptyOrOversizedSelection(t *testing.T) {
	service := &Service{}
	never := func(context.Context, uuid.UUID) error {
		t.Fatal("removal must not run for a rejected selection")
		return nil
	}
	if _, err := service.deleteEach(context.Background(), nil, never); !errors.Is(err, ErrNoDocumentsSelected) {
		t.Fatalf("empty selection error = %v, want ErrNoDocumentsSelected", err)
	}
	tooMany := make([]uuid.UUID, MaxBulkDocuments+1)
	for index := range tooMany {
		tooMany[index] = uuid.New()
	}
	if _, err := service.deleteEach(context.Background(), tooMany, never); !errors.Is(err, ErrTooManyDocuments) {
		t.Fatalf("oversized selection error = %v, want ErrTooManyDocuments", err)
	}
}

func TestDeleteEachRemovesEachDocumentOnce(t *testing.T) {
	id := uuid.New()
	calls := 0
	result, err := (&Service{}).deleteEach(context.Background(), []uuid.UUID{id, id, id}, func(context.Context, uuid.UUID) error {
		calls++
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("removal ran %d times, want 1 for a repeated id", calls)
	}
	if len(result.Deleted) != 1 || result.Deleted[0] != id || len(result.Failures) != 0 {
		t.Fatalf("unexpected result: %#v", result)
	}
}

// A document someone else already purged must not cost the rest of the batch.
func TestDeleteEachItemisesFailuresWithoutStopping(t *testing.T) {
	missing, first, last := uuid.New(), uuid.New(), uuid.New()
	result, err := (&Service{}).deleteEach(context.Background(), []uuid.UUID{first, missing, last}, func(_ context.Context, id uuid.UUID) error {
		if id == missing {
			return ErrNotFound
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Deleted) != 2 || result.Deleted[0] != first || result.Deleted[1] != last {
		t.Fatalf("surviving documents were not removed: %#v", result.Deleted)
	}
	if len(result.Failures) != 1 || result.Failures[0].DocumentID != missing || !errors.Is(result.Failures[0].Reason, ErrNotFound) {
		t.Fatalf("unexpected failures: %#v", result.Failures)
	}
}

// Permanent deletion cannot be undone, so an abandoned request must report what
// it already committed rather than pretending nothing happened.
func TestDeleteEachStopsOnAnAbandonedRequestAndKeepsCommittedWork(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	first, second := uuid.New(), uuid.New()
	result, err := (&Service{}).deleteEach(ctx, []uuid.UUID{first, second}, func(_ context.Context, id uuid.UUID) error {
		if id == first {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context.Canceled", err)
	}
	if len(result.Deleted) != 1 || result.Deleted[0] != first {
		t.Fatalf("committed work was lost: %#v", result.Deleted)
	}
}
