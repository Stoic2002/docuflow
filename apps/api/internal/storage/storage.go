package storage

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var ErrUnsafePath = errors.New("unsafe storage path")

type Store struct {
	root string
}

type stagedPath struct {
	source string
	target string
}

// StagedDeletion contains files atomically moved into the storage temporary
// directory. Rollback restores them; Commit permanently removes them.
type StagedDeletion struct {
	paths []stagedPath
}

var directories = []string{"originals", "versions", "outputs", "thumbnails", "temporary"}

func New(root string) (*Store, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, fmt.Errorf("resolve storage root: %w", err)
	}
	for _, directory := range directories {
		if err := os.MkdirAll(filepath.Join(absRoot, directory), 0o750); err != nil {
			return nil, fmt.Errorf("create storage directory %s: %w", directory, err)
		}
	}
	return &Store{root: filepath.Clean(absRoot)}, nil
}

func (s *Store) Resolve(relativePath string) (string, error) {
	if relativePath == "" || filepath.IsAbs(relativePath) {
		return "", ErrUnsafePath
	}
	clean := filepath.Clean(filepath.FromSlash(relativePath))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	candidate := filepath.Join(s.root, clean)
	relativeToRoot, err := filepath.Rel(s.root, candidate)
	if err != nil || relativeToRoot == ".." || strings.HasPrefix(relativeToRoot, ".."+string(filepath.Separator)) {
		return "", ErrUnsafePath
	}
	return candidate, nil
}

func (s *Store) Relative(directory, filename string) (string, error) {
	if !contains(directories, directory) || filename == "" || filepath.Base(filename) != filename {
		return "", ErrUnsafePath
	}
	relative := filepath.ToSlash(filepath.Join(directory, filename))
	if _, err := s.Resolve(relative); err != nil {
		return "", err
	}
	return relative, nil
}

func (s *Store) Open(relativePath string) (*os.File, error) {
	path, err := s.Resolve(relativePath)
	if err != nil {
		return nil, err
	}
	return os.Open(path)
}

func (s *Store) Writable() bool {
	temporaryDir, err := s.Resolve("temporary")
	if err != nil {
		return false
	}
	file, err := os.CreateTemp(temporaryDir, ".health-*")
	if err != nil {
		return false
	}
	name := file.Name()
	closeErr := file.Close()
	removeErr := os.Remove(name)
	return closeErr == nil && removeErr == nil
}

// CommitTemp fsyncs and atomically renames a completed temporary file.
func (s *Store) CommitTemp(temp *os.File, destinationRelative string) error {
	destination, err := s.Resolve(destinationRelative)
	if err != nil {
		return err
	}
	if err := temp.Sync(); err != nil {
		return fmt.Errorf("sync temporary output: %w", err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("close temporary output: %w", err)
	}
	if err := os.Rename(temp.Name(), destination); err != nil {
		return fmt.Errorf("commit output: %w", err)
	}
	return nil
}

func (s *Store) CreateTemp(pattern string) (*os.File, error) {
	directory, err := s.Resolve("temporary")
	if err != nil {
		return nil, err
	}
	return os.CreateTemp(directory, pattern)
}

func (s *Store) StageDeletion(relativePaths []string) (*StagedDeletion, error) {
	seen := make(map[string]struct{}, len(relativePaths))
	resolved := make([]string, 0, len(relativePaths))
	for _, relativePath := range relativePaths {
		if _, exists := seen[relativePath]; exists {
			continue
		}
		seen[relativePath] = struct{}{}
		path, err := s.Resolve(relativePath)
		if err != nil {
			return nil, err
		}
		resolved = append(resolved, path)
	}
	temporaryDirectory, err := s.Resolve("temporary")
	if err != nil {
		return nil, err
	}
	staged := &StagedDeletion{}
	rollback := func(stageErr error) (*StagedDeletion, error) {
		if restoreErr := staged.Rollback(); restoreErr != nil {
			return nil, fmt.Errorf("%w; rollback staged deletion: %v", stageErr, restoreErr)
		}
		return nil, stageErr
	}
	for _, source := range resolved {
		if _, statErr := os.Stat(source); errors.Is(statErr, os.ErrNotExist) {
			continue
		} else if statErr != nil {
			return rollback(fmt.Errorf("inspect file for deletion: %w", statErr))
		}
		marker, createErr := os.CreateTemp(temporaryDirectory, "purge-*")
		if createErr != nil {
			return rollback(fmt.Errorf("create deletion staging path: %w", createErr))
		}
		target := marker.Name()
		if closeErr := marker.Close(); closeErr != nil {
			_ = os.Remove(target)
			return rollback(fmt.Errorf("close deletion staging marker: %w", closeErr))
		}
		if removeErr := os.Remove(target); removeErr != nil {
			return rollback(fmt.Errorf("prepare deletion staging path: %w", removeErr))
		}
		if renameErr := os.Rename(source, target); renameErr != nil {
			return rollback(fmt.Errorf("stage file for deletion: %w", renameErr))
		}
		staged.paths = append(staged.paths, stagedPath{source: source, target: target})
	}
	return staged, nil
}

func (s *StagedDeletion) Rollback() error {
	var firstErr error
	for index := len(s.paths) - 1; index >= 0; index-- {
		path := s.paths[index]
		if err := os.Rename(path.target, path.source); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	s.paths = nil
	return firstErr
}

func (s *StagedDeletion) Commit() error {
	var firstErr error
	for _, path := range s.paths {
		if err := os.Remove(path.target); err != nil && !errors.Is(err, os.ErrNotExist) && firstErr == nil {
			firstErr = err
		}
	}
	s.paths = nil
	return firstErr
}

func contains(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}
