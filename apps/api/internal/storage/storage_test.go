package storage

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestResolveRejectsTraversalAndAbsolutePaths(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cases := []string{"", "../secret.pdf", "originals/../../secret.pdf", "/tmp/secret.pdf", ".."}
	for _, candidate := range cases {
		t.Run(candidate, func(t *testing.T) {
			if _, err := store.Resolve(candidate); !errors.Is(err, ErrUnsafePath) {
				t.Fatalf("Resolve(%q) error = %v, want ErrUnsafePath", candidate, err)
			}
		})
	}
}

func TestResolveKeepsPathInsideRoot(t *testing.T) {
	root := t.TempDir()
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := store.Resolve("originals/fixture.pdf")
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(root, "originals", "fixture.pdf")
	if resolved != want {
		t.Fatalf("Resolve() = %q, want %q", resolved, want)
	}
}

func TestRelativeRejectsUnknownDirectoryAndNestedFilename(t *testing.T) {
	store, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, input := range [][2]string{{"secrets", "file.pdf"}, {"originals", "nested/file.pdf"}, {"versions", "../file.pdf"}} {
		if _, err := store.Relative(input[0], input[1]); !errors.Is(err, ErrUnsafePath) {
			t.Fatalf("Relative(%q, %q) error = %v", input[0], input[1], err)
		}
	}
}

func TestStageDeletionCanRollbackAndDeduplicatesPaths(t *testing.T) {
	root := t.TempDir()
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "originals", "fixture.pdf")
	if err := os.WriteFile(path, []byte("pdf"), 0o440); err != nil {
		t.Fatal(err)
	}
	staged, err := store.StageDeletion([]string{"originals/fixture.pdf", "originals/fixture.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("source should be staged, stat error = %v", err)
	}
	if len(staged.paths) != 1 {
		t.Fatalf("staged path count = %d, want 1", len(staged.paths))
	}
	if err := staged.Rollback(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("source should be restored: %v", err)
	}
}

func TestStageDeletionRejectsUnsafePathBeforeMovingFiles(t *testing.T) {
	root := t.TempDir()
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "originals", "fixture.pdf")
	if err := os.WriteFile(path, []byte("pdf"), 0o440); err != nil {
		t.Fatal(err)
	}
	if _, err := store.StageDeletion([]string{"originals/fixture.pdf", "../outside.pdf"}); !errors.Is(err, ErrUnsafePath) {
		t.Fatalf("error = %v, want ErrUnsafePath", err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("safe file moved before validation completed: %v", err)
	}
}

func TestStageDeletionCommitPermanentlyRemovesFile(t *testing.T) {
	root := t.TempDir()
	store, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "versions", "fixture.pdf")
	if err := os.WriteFile(path, []byte("pdf"), 0o440); err != nil {
		t.Fatal(err)
	}
	staged, err := store.StageDeletion([]string{"versions/fixture.pdf"})
	if err != nil {
		t.Fatal(err)
	}
	if err := staged.Commit(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file should be permanently removed, stat error = %v", err)
	}
}
