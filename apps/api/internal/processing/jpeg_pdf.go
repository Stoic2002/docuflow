package processing

import (
	"errors"
	"fmt"
	"image/color"
	"image/jpeg"
	"io"
	"os"
	"strings"
)

const (
	maxJPEGDimension = 30_000
	maxJPEGPixels    = 100_000_000
)

var (
	ErrInvalidJPEG       = errors.New("invalid JPEG image")
	ErrJPEGDimensions    = errors.New("JPEG dimensions exceed the safe limit")
	ErrJPEGInputRequired = errors.New("at least one JPEG image is required")
)

type JPEGColorSpace string

const (
	JPEGGray JPEGColorSpace = "DeviceGray"
	JPEGRGB  JPEGColorSpace = "DeviceRGB"
	JPEGCMYK JPEGColorSpace = "DeviceCMYK"
)

// JPEGInput is a validated, server-owned temporary JPEG source. Path is never
// populated from a request field; the HTTP layer creates it below STORAGE_ROOT.
type JPEGInput struct {
	Path       string
	Name       string
	ByteSize   int64
	Width      int
	Height     int
	ColorSpace JPEGColorSpace
}

func InspectJPEG(path, name string, byteSize int64) (JPEGInput, error) {
	file, err := os.Open(path)
	if err != nil {
		return JPEGInput{}, fmt.Errorf("open JPEG: %w", err)
	}
	defer file.Close()
	config, err := jpeg.DecodeConfig(file)
	if err != nil || config.Width < 1 || config.Height < 1 {
		return JPEGInput{}, ErrInvalidJPEG
	}
	if config.Width > maxJPEGDimension || config.Height > maxJPEGDimension || int64(config.Width)*int64(config.Height) > maxJPEGPixels {
		return JPEGInput{}, ErrJPEGDimensions
	}
	colorSpace := JPEGRGB
	switch config.ColorModel.Convert(color.RGBA{R: 11, G: 37, B: 83, A: 255}).(type) {
	case color.Gray:
		colorSpace = JPEGGray
	case color.CMYK:
		colorSpace = JPEGCMYK
	}
	return JPEGInput{
		Path: path, Name: name, ByteSize: byteSize,
		Width: config.Width, Height: config.Height, ColorSpace: colorSpace,
	}, nil
}

type pdfWriter struct {
	file    *os.File
	offsets []int64
	err     error
}

func (w *pdfWriter) write(value string) {
	if w.err != nil {
		return
	}
	_, w.err = io.WriteString(w.file, value)
}

func (w *pdfWriter) startObject(id int) {
	if w.err != nil {
		return
	}
	offset, err := w.file.Seek(0, io.SeekCurrent)
	if err != nil {
		w.err = err
		return
	}
	w.offsets[id] = offset
	w.write(fmt.Sprintf("%d 0 obj\n", id))
}

func (w *pdfWriter) endObject() { w.write("\nendobj\n") }

func (w *pdfWriter) copyFile(path string) {
	if w.err != nil {
		return
	}
	input, err := os.Open(path)
	if err != nil {
		w.err = err
		return
	}
	_, copyErr := io.Copy(w.file, input)
	closeErr := input.Close()
	if copyErr != nil {
		w.err = copyErr
	} else if closeErr != nil {
		w.err = closeErr
	}
}

func pagePlacement(image JPEGInput) (pageWidth, pageHeight, drawWidth, drawHeight, x, y float64) {
	const (
		a4Short = 595.28
		a4Long  = 841.89
		margin  = 24.0
	)
	pageWidth, pageHeight = a4Short, a4Long
	if image.Width > image.Height {
		pageWidth, pageHeight = a4Long, a4Short
	}
	widthScale := (pageWidth - 2*margin) / float64(image.Width)
	heightScale := (pageHeight - 2*margin) / float64(image.Height)
	scale := widthScale
	if heightScale < scale {
		scale = heightScale
	}
	drawWidth = float64(image.Width) * scale
	drawHeight = float64(image.Height) * scale
	x = (pageWidth - drawWidth) / 2
	y = (pageHeight - drawHeight) / 2
	return
}

// WriteJPEGsAsPDF embeds the original JPEG streams without decoding them into
// memory. Each input becomes one auto-oriented A4 page and preserves ordering.
func WriteJPEGsAsPDF(output *os.File, images []JPEGInput) error {
	if len(images) == 0 {
		return ErrJPEGInputRequired
	}
	if err := output.Truncate(0); err != nil {
		return fmt.Errorf("reset PDF output: %w", err)
	}
	if _, err := output.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("seek PDF output: %w", err)
	}
	objectCount := 2 + len(images)*3
	writer := &pdfWriter{file: output, offsets: make([]int64, objectCount+1)}
	writer.write("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	writer.startObject(1)
	writer.write("<< /Type /Catalog /Pages 2 0 R >>")
	writer.endObject()
	writer.startObject(2)
	kids := make([]string, len(images))
	for index := range images {
		kids[index] = fmt.Sprintf("%d 0 R", 3+index*3)
	}
	writer.write(fmt.Sprintf("<< /Type /Pages /Count %d /Kids [%s] >>", len(images), strings.Join(kids, " ")))
	writer.endObject()

	for index, image := range images {
		pageID := 3 + index*3
		contentID := pageID + 1
		imageID := pageID + 2
		pageWidth, pageHeight, drawWidth, drawHeight, x, y := pagePlacement(image)
		content := fmt.Sprintf("q\n%.4f 0 0 %.4f %.4f %.4f cm\n/Im0 Do\nQ\n", drawWidth, drawHeight, x, y)

		writer.startObject(pageID)
		writer.write(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>", pageWidth, pageHeight, imageID, contentID))
		writer.endObject()

		writer.startObject(contentID)
		writer.write(fmt.Sprintf("<< /Length %d >>\nstream\n%s endstream", len(content), content))
		writer.endObject()

		stat, err := os.Stat(image.Path)
		if err != nil {
			return fmt.Errorf("inspect JPEG source: %w", err)
		}
		decode := ""
		if image.ColorSpace == JPEGCMYK {
			decode = " /Decode [1 0 1 0 1 0 1 0]"
		}
		writer.startObject(imageID)
		writer.write(fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /%s /BitsPerComponent 8 /Filter /DCTDecode /Length %d%s >>\nstream\n", image.Width, image.Height, image.ColorSpace, stat.Size(), decode))
		writer.copyFile(image.Path)
		writer.write("\nendstream")
		writer.endObject()
	}
	if writer.err != nil {
		return fmt.Errorf("write PDF objects: %w", writer.err)
	}
	xrefOffset, err := output.Seek(0, io.SeekCurrent)
	if err != nil {
		return fmt.Errorf("locate PDF xref: %w", err)
	}
	writer.write(fmt.Sprintf("xref\n0 %d\n0000000000 65535 f \n", objectCount+1))
	for id := 1; id <= objectCount; id++ {
		writer.write(fmt.Sprintf("%010d 00000 n \n", writer.offsets[id]))
	}
	writer.write(fmt.Sprintf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", objectCount+1, xrefOffset))
	if writer.err != nil {
		return fmt.Errorf("write PDF xref: %w", writer.err)
	}
	if err := output.Sync(); err != nil {
		return fmt.Errorf("sync PDF output: %w", err)
	}
	return nil
}
