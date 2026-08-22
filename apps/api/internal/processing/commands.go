package processing

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"
)

const (
	CodeToolUnavailable = "PDF_TOOL_UNAVAILABLE"
	CodeToolTimeout     = "PDF_TOOL_TIMEOUT"
	CodeToolFailed      = "PDF_TOOL_FAILED"
)

type ToolError struct {
	Code   string
	Tool   string
	Output string
	Err    error
}

func (e *ToolError) Error() string { return fmt.Sprintf("%s: %v", e.Tool, e.Err) }
func (e *ToolError) Unwrap() error { return e.Err }

func RunCommand(ctx context.Context, tool, workingDirectory string, args []string) error {
	executable, err := exec.LookPath(tool)
	if err != nil {
		return &ToolError{Code: CodeToolUnavailable, Tool: tool, Err: err}
	}
	var output limitedBuffer
	command := exec.CommandContext(ctx, executable, args...)
	command.Dir = workingDirectory
	command.Stdout = &output
	command.Stderr = &output
	err = command.Run()
	if err == nil {
		return nil
	}
	code := CodeToolFailed
	if errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded) {
		code = CodeToolTimeout
	}
	return &ToolError{Code: code, Tool: tool, Output: output.String(), Err: err}
}

func RunAndCapture(ctx context.Context, tool string, args []string) (string, error) {
	executable, err := exec.LookPath(tool)
	if err != nil {
		return "", &ToolError{Code: CodeToolUnavailable, Tool: tool, Err: err}
	}
	var output limitedBuffer
	command := exec.CommandContext(ctx, executable, args...)
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		return output.String(), &ToolError{Code: CodeToolFailed, Tool: tool, Output: output.String(), Err: err}
	}
	return output.String(), nil
}

func ErrorCode(err error) string {
	var toolError *ToolError
	if errors.As(err, &toolError) {
		return toolError.Code
	}
	return "PDF_PROCESSING_FAILED"
}

func QPDFMergeArgs(inputs []string, output string) ([]string, error) {
	if len(inputs) < 2 {
		return nil, errors.New("merge requires at least two inputs")
	}
	args := []string{"--empty", "--pages"}
	for _, input := range inputs {
		if input == "" || !filepath.IsAbs(input) {
			return nil, errors.New("merge input path must be resolved by storage")
		}
		args = append(args, input, "1-z")
	}
	return append(args, "--", output), nil
}

func QPDFExtractArgs(input, selection, output string) ([]string, error) {
	if err := ValidatePageSelection(selection); err != nil {
		return nil, err
	}
	return []string{input, "--pages", ".", selection, "--", output}, nil
}

func QPDFReorderArgs(input string, order []int, output string) ([]string, error) {
	if len(order) == 0 {
		return nil, errors.New("page order cannot be empty")
	}
	return []string{input, "--pages", ".", PageList(order), "--", output}, nil
}

func QPDFDuplicateArgs(input string, order []int, output string) ([]string, error) {
	if len(order) == 0 {
		return nil, errors.New("page order cannot be empty")
	}
	return []string{input, "--pages", ".", PageList(order), "--", output}, nil
}

func QPDFInsertArgs(input string, before []int, inserted string, insertedPages []int, after []int, output string) ([]string, error) {
	if input == "" || inserted == "" || !filepath.IsAbs(input) || !filepath.IsAbs(inserted) {
		return nil, errors.New("insert paths must be resolved by storage")
	}
	if len(insertedPages) == 0 {
		return nil, errors.New("inserted PDF must contain pages")
	}
	args := []string{"--empty", "--pages"}
	if len(before) > 0 {
		args = append(args, input, PageList(before))
	}
	args = append(args, inserted, PageList(insertedPages))
	if len(after) > 0 {
		args = append(args, input, PageList(after))
	}
	return append(args, "--", output), nil
}

func QPDFProtectArgs(input, output, password, ownerPassword string, printing, copying, modification, annotation, formFilling, assembly bool) ([]string, error) {
	if password == "" || len(password) > 128 {
		return nil, errors.New("open password is required and must not exceed 128 characters")
	}
	if ownerPassword == "" || ownerPassword == password {
		return nil, errors.New("a distinct owner password is required")
	}
	yn := func(value bool) string {
		if value {
			return "y"
		}
		return "n"
	}
	printMode := "none"
	if printing {
		printMode = "full"
	}
	modifyMode := "none"
	if modification {
		modifyMode = "all"
	}
	return []string{
		"--encrypt", "--user-password=" + password, "--owner-password=" + ownerPassword, "--bits=256",
		"--print=" + printMode, "--extract=" + yn(copying), "--modify=" + modifyMode,
		"--annotate=" + yn(annotation), "--form=" + yn(formFilling), "--assemble=" + yn(assembly),
		"--", input, output,
	}, nil
}

func QPDFUnlockArgs(input, output, password string) []string {
	return []string{"--password=" + password, "--decrypt", input, output}
}

func QPDFOverlayArgs(input, overlay, output string, foreground bool) ([]string, error) {
	if input == "" || overlay == "" || !filepath.IsAbs(input) || !filepath.IsAbs(overlay) {
		return nil, errors.New("overlay paths must be resolved by storage")
	}
	mode := "--underlay"
	if foreground {
		mode = "--overlay"
	}
	return []string{input, mode, overlay, "--", output}, nil
}

func QPDFRotateArgs(input string, degrees int, pages []int, output string) ([]string, error) {
	if degrees != 90 && degrees != 180 && degrees != 270 && degrees != -90 && degrees != -180 && degrees != -270 {
		return nil, errors.New("rotation must be a multiple of 90 degrees")
	}
	if len(pages) == 0 {
		return nil, errors.New("at least one page is required")
	}
	sign := "+"
	if degrees < 0 {
		sign = "-"
		degrees = -degrees
	}
	return []string{input, fmt.Sprintf("--rotate=%s%d:%s", sign, degrees, PageList(pages)), output}, nil
}

func QPDFCompressArgs(input, output string) []string {
	return []string{
		"--object-streams=generate", "--recompress-flate", "--compression-level=9",
		"--linearize", input, output,
	}
}

func OCRmyPDFArgs(input, output, language string) ([]string, error) {
	if language != "eng" && language != "ind" {
		return nil, errors.New("OCR language must be eng or ind")
	}
	return []string{
		"--skip-text", "--language", language, "--output-type", "pdf", "--optimize", "0",
		"--jobs", "1", input, output,
	}, nil
}

func ValidatePageSelection(selection string) error {
	if selection == "" || len(selection) > 1024 {
		return errors.New("page selection is empty or too long")
	}
	for _, value := range selection {
		if !unicode.IsDigit(value) && value != '-' && value != ',' {
			return errors.New("page selection contains unsupported characters")
		}
	}
	for _, part := range strings.Split(selection, ",") {
		bounds := strings.Split(part, "-")
		if len(bounds) > 2 || len(bounds) == 0 {
			return errors.New("invalid page range")
		}
		start, err := strconv.Atoi(bounds[0])
		if err != nil || start <= 0 {
			return errors.New("page numbers must be positive")
		}
		if len(bounds) == 2 {
			end, err := strconv.Atoi(bounds[1])
			if err != nil || end < start {
				return errors.New("page range end must be greater than or equal to start")
			}
		}
	}
	return nil
}

func ValidatePageSelectionWithin(selection string, pageCount int) error {
	if pageCount < 1 {
		return errors.New("page count must be positive")
	}
	if err := ValidatePageSelection(selection); err != nil {
		return err
	}
	for _, part := range strings.Split(selection, ",") {
		bounds := strings.Split(part, "-")
		end, err := strconv.Atoi(bounds[len(bounds)-1])
		if err != nil || end > pageCount {
			return errors.New("page selection exceeds document page count")
		}
	}
	return nil
}

func ExpandPageSelection(selection string, pageCount int) ([]int, error) {
	if err := ValidatePageSelectionWithin(selection, pageCount); err != nil {
		return nil, err
	}
	pages := make([]int, 0)
	seen := make(map[int]struct{})
	for _, part := range strings.Split(selection, ",") {
		bounds := strings.Split(part, "-")
		start, _ := strconv.Atoi(bounds[0])
		end := start
		if len(bounds) == 2 {
			end, _ = strconv.Atoi(bounds[1])
		}
		for page := start; page <= end; page++ {
			if _, exists := seen[page]; exists {
				return nil, errors.New("page selection contains duplicates")
			}
			seen[page] = struct{}{}
			pages = append(pages, page)
		}
	}
	return pages, nil
}

func PageList(pages []int) string {
	values := make([]string, len(pages))
	for index, page := range pages {
		values[index] = strconv.Itoa(page)
	}
	return strings.Join(values, ",")
}

func ValidatePageOrder(order []int, pageCount int) error {
	if len(order) == 0 || len(order) > pageCount {
		return errors.New("page order length is invalid")
	}
	seen := make(map[int]struct{}, len(order))
	for _, page := range order {
		if page < 1 || page > pageCount {
			return errors.New("page number is outside the document")
		}
		if _, exists := seen[page]; exists {
			return errors.New("page order contains duplicates")
		}
		seen[page] = struct{}{}
	}
	return nil
}
