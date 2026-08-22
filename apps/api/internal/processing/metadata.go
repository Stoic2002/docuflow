package processing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var (
	infoReference = regexp.MustCompile(`/Info\s+([0-9]+)\s+([0-9]+)\s+R`)
	sizeEntry     = regexp.MustCompile(`/Size\s+([0-9]+)`)
)

type PDFMetadata struct {
	Title    string `json:"title"`
	Author   string `json:"author"`
	Subject  string `json:"subject"`
	Keywords string `json:"keywords"`
}

func qpdfOutput(ctx context.Context, args ...string) (string, error) {
	executable, err := exec.LookPath("qpdf")
	if err != nil {
		return "", err
	}
	var output limitedBuffer
	command := exec.CommandContext(ctx, executable, args...)
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		return "", &ToolError{Code: CodeToolFailed, Tool: "qpdf", Output: output.String(), Err: err}
	}
	return output.String(), nil
}

func readInfoReference(ctx context.Context, input string) (string, int, error) {
	trailer, err := qpdfOutput(ctx, "--show-object=trailer", input)
	if err != nil {
		return "", 0, err
	}
	sizeMatch := sizeEntry.FindStringSubmatch(trailer)
	if len(sizeMatch) != 2 {
		return "", 0, errors.New("PDF trailer size is unavailable")
	}
	size, err := strconv.Atoi(sizeMatch[1])
	if err != nil || size < 1 {
		return "", 0, errors.New("PDF trailer size is invalid")
	}
	match := infoReference.FindStringSubmatch(trailer)
	if len(match) != 3 {
		return "", size, nil
	}
	return match[1] + " " + match[2] + " R", size, nil
}

func ReadPDFMetadata(ctx context.Context, input string) (PDFMetadata, error) {
	reference, _, err := readInfoReference(ctx, input)
	if err != nil {
		return PDFMetadata{}, err
	}
	if reference == "" {
		return PDFMetadata{}, nil
	}
	value, err := qpdfOutput(ctx, "--json=1", "--json-key=objects", "--json-object="+reference, input)
	if err != nil {
		return PDFMetadata{}, err
	}
	var payload struct {
		Objects map[string]map[string]any `json:"objects"`
	}
	if err := json.Unmarshal([]byte(value), &payload); err != nil {
		return PDFMetadata{}, fmt.Errorf("decode PDF metadata: %w", err)
	}
	info := payload.Objects[reference]
	text := func(key string) string {
		value, _ := info[key].(string)
		if infoReference.MatchString("/Info " + value) {
			objectJSON, objectErr := qpdfOutput(ctx, "--json=1", "--json-key=objects", "--json-object="+value, input)
			if objectErr == nil {
				var objectPayload struct {
					Objects map[string]any `json:"objects"`
				}
				if json.Unmarshal([]byte(objectJSON), &objectPayload) == nil {
					if resolved, ok := objectPayload.Objects[value].(string); ok {
						return resolved
					}
				}
			}
		}
		return value
	}
	return PDFMetadata{Title: text("/Title"), Author: text("/Author"), Subject: text("/Subject"), Keywords: text("/Keywords")}, nil
}

func WriteMetadataUpdateJSON(ctx context.Context, input, destination string, updates map[string]*string) error {
	reference, _, err := readInfoReference(ctx, input)
	if err != nil {
		return err
	}
	args := []string{"--json", "--json-key=qpdf", "--json-object=trailer"}
	if reference != "" {
		args = append(args, "--json-object="+reference)
	}
	args = append(args, input)
	value, err := qpdfOutput(ctx, args...)
	if err != nil {
		return err
	}
	var payload struct {
		QPDF []map[string]any `json:"qpdf"`
	}
	if err := json.Unmarshal([]byte(value), &payload); err != nil || len(payload.QPDF) != 2 {
		return errors.New("qpdf metadata JSON is invalid")
	}
	objects := payload.QPDF[1]
	if reference == "" {
		header := payload.QPDF[0]
		maxID, ok := header["maxobjectid"].(float64)
		if !ok {
			return errors.New("qpdf maximum object ID is unavailable")
		}
		reference = fmt.Sprintf("%.0f 0 R", maxID+1)
		header["maxobjectid"] = maxID + 1
		trailerObject, ok := objects["trailer"].(map[string]any)
		if !ok {
			return errors.New("qpdf trailer JSON is invalid")
		}
		trailer, ok := trailerObject["value"].(map[string]any)
		if !ok {
			return errors.New("qpdf trailer value is invalid")
		}
		trailer["/Info"] = reference
		objects["obj:"+reference] = map[string]any{"value": map[string]any{}}
	}
	object, ok := objects["obj:"+reference].(map[string]any)
	if !ok {
		return errors.New("qpdf info object is invalid")
	}
	info, ok := object["value"].(map[string]any)
	if !ok {
		return errors.New("qpdf info dictionary is invalid")
	}
	for field, value := range updates {
		key := "/" + strings.TrimPrefix(field, "/")
		if value == nil || *value == "" {
			delete(info, key)
		} else {
			info[key] = "u:" + *value
		}
	}
	encoded, err := json.Marshal(map[string]any{"qpdf": payload.QPDF})
	if err != nil {
		return err
	}
	if err := os.WriteFile(destination, encoded, 0o600); err != nil {
		return fmt.Errorf("write metadata update: %w", err)
	}
	return nil
}
