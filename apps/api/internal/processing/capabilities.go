package processing

import (
	"bytes"
	"context"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type ToolCapability struct {
	Available bool     `json:"available"`
	Version   string   `json:"version,omitempty"`
	Reason    string   `json:"reason,omitempty"`
	Languages []string `json:"languages,omitempty"`
}

type Capabilities struct {
	QPDF     ToolCapability
	OCRmyPDF ToolCapability
	PDFInfo  ToolCapability
	PDFToPPM ToolCapability
}

type Detector struct {
	once  sync.Once
	value Capabilities
}

func (d *Detector) Detect() Capabilities {
	d.once.Do(func() {
		d.value = Capabilities{
			QPDF:     detectTool("qpdf", "--version"),
			OCRmyPDF: detectTool("ocrmypdf", "--version"),
			PDFInfo:  detectTool("pdfinfo", "-v"),
			PDFToPPM: detectTool("pdftoppm", "-v"),
		}
		if d.value.OCRmyPDF.Available {
			d.value.OCRmyPDF.Languages = detectOCRLanguages()
		}
	})
	return d.value
}

func detectOCRLanguages() []string {
	path, err := exec.LookPath("tesseract")
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var output limitedBuffer
	command := exec.CommandContext(ctx, path, "--list-langs")
	command.Stdout = &output
	command.Stderr = &output
	if command.Run() != nil {
		return nil
	}
	return parseOCRLanguageOutput(output.String())
}

func parseOCRLanguageOutput(output string) []string {
	lines := strings.Split(output, "\n")
	languages := make([]string, 0, len(lines))
	for _, line := range lines {
		language := strings.TrimSpace(line)
		if language == "" || strings.HasPrefix(language, "List of available languages") {
			continue
		}
		languages = append(languages, language)
	}
	return languages
}

func detectTool(name string, args ...string) ToolCapability {
	path, err := exec.LookPath(name)
	if err != nil {
		return ToolCapability{Reason: name + " is not installed or is not on PATH"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var output limitedBuffer
	command := exec.CommandContext(ctx, path, args...)
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		return ToolCapability{Reason: name + " was found but its version could not be read"}
	}
	return ToolCapability{Available: true, Version: strings.TrimSpace(output.String())}
}

type limitedBuffer struct {
	buffer bytes.Buffer
}

const maxCommandOutput = 64 * 1024

func (b *limitedBuffer) Write(value []byte) (int, error) {
	originalLength := len(value)
	remaining := maxCommandOutput - b.buffer.Len()
	if remaining > 0 {
		if len(value) > remaining {
			value = value[:remaining]
		}
		_, _ = b.buffer.Write(value)
	}
	return originalLength, nil
}

func (b *limitedBuffer) String() string { return b.buffer.String() }
