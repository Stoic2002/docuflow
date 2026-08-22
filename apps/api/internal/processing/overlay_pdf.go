package processing

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

type PageSize struct {
	Width  float64
	Height float64
}

type TextOverlay struct {
	Text     string
	X        float64
	Y        float64
	FontSize float64
	Opacity  float64
	Rotation float64
	Align    string
}

type ImageOverlay struct {
	Image    JPEGInput
	CenterX  float64
	CenterY  float64
	Width    float64
	Height   float64
	Opacity  float64
	Rotation float64
}

type OverlayPage struct {
	PageSize
	Texts []TextOverlay
	Image *ImageOverlay
}

var pageSizeLine = regexp.MustCompile(`^Page\s+([0-9]+) size:\s+([0-9.]+) x ([0-9.]+) pts`)

func PDFPageSizes(ctx context.Context, inputPath, password string) ([]PageSize, error) {
	executable, err := exec.LookPath("pdfinfo")
	if err != nil {
		return nil, err
	}
	args := []string{}
	if password != "" {
		args = append(args, "-upw", password)
	}
	args = append(args, "-f", "1", "-l", "1000000", inputPath)
	command := exec.CommandContext(ctx, executable, args...)
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	var commandError limitedBuffer
	command.Stderr = &commandError
	if err := command.Start(); err != nil {
		return nil, fmt.Errorf("start pdfinfo: %w", err)
	}
	sizes := []PageSize{}
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		match := pageSizeLine.FindStringSubmatch(scanner.Text())
		if len(match) != 4 {
			continue
		}
		width, widthErr := strconv.ParseFloat(match[2], 64)
		height, heightErr := strconv.ParseFloat(match[3], 64)
		if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
			return nil, errors.New("pdfinfo returned an invalid page size")
		}
		sizes = append(sizes, PageSize{Width: width, Height: height})
	}
	if err := scanner.Err(); err != nil {
		_ = command.Wait()
		return nil, err
	}
	if err := command.Wait(); err != nil {
		return nil, fmt.Errorf("read PDF page sizes: %w", err)
	}
	if len(sizes) == 0 {
		return nil, errors.New("PDF page dimensions are unavailable")
	}
	return sizes, nil
}

func PresetPageSize(name, orientation string) (PageSize, error) {
	var result PageSize
	switch strings.ToLower(name) {
	case "a4":
		result = PageSize{Width: 595.28, Height: 841.89}
	case "letter":
		result = PageSize{Width: 612, Height: 792}
	default:
		return PageSize{}, errors.New("page size must be A4 or Letter")
	}
	if orientation == "landscape" {
		result.Width, result.Height = result.Height, result.Width
	} else if orientation != "portrait" && orientation != "" {
		return PageSize{}, errors.New("orientation must be portrait or landscape")
	}
	return result, nil
}

func WriteBlankPDF(output *os.File, sizes []PageSize) error {
	pages := make([]OverlayPage, len(sizes))
	for index, size := range sizes {
		pages[index] = OverlayPage{PageSize: size}
	}
	return WriteOverlayPDF(output, pages)
}

func escapePDFText(value string) string {
	var result strings.Builder
	for len(value) > 0 {
		r, size := utf8.DecodeRuneInString(value)
		value = value[size:]
		if r < 32 || r > 255 {
			r = '?'
		}
		switch r {
		case '\\', '(', ')':
			result.WriteByte('\\')
		}
		result.WriteRune(r)
	}
	return result.String()
}

func clampOpacity(value float64) float64 {
	if value < 0.05 {
		return 0.05
	}
	if value > 1 {
		return 1
	}
	return value
}

func overlayContent(page OverlayPage) string {
	var content strings.Builder
	for _, text := range page.Texts {
		fontSize := text.FontSize
		if fontSize < 6 {
			fontSize = 6
		}
		if fontSize > 144 {
			fontSize = 144
		}
		x := text.X
		estimatedWidth := float64(utf8.RuneCountInString(text.Text)) * fontSize * 0.52
		if text.Align == "center" {
			x -= estimatedWidth / 2
		}
		if text.Align == "right" {
			x -= estimatedWidth
		}
		angle := text.Rotation * math.Pi / 180
		cosine, sine := math.Cos(angle), math.Sin(angle)
		fmt.Fprintf(&content, "q /GS%.0f gs BT /F1 %.3f Tf 0 0 0 rg %.6f %.6f %.6f %.6f %.3f %.3f Tm (%s) Tj ET Q\n",
			math.Round(clampOpacity(text.Opacity)*1000), fontSize, cosine, sine, -sine, cosine, x, text.Y, escapePDFText(text.Text))
	}
	if image := page.Image; image != nil {
		angle := image.Rotation * math.Pi / 180
		cosine, sine := math.Cos(angle), math.Sin(angle)
		a, b := image.Width*cosine, image.Width*sine
		c, d := -image.Height*sine, image.Height*cosine
		e := image.CenterX - (a+c)/2
		f := image.CenterY - (b+d)/2
		fmt.Fprintf(&content, "q /GS%.0f gs %.6f %.6f %.6f %.6f %.3f %.3f cm /Im0 Do Q\n",
			math.Round(clampOpacity(image.Opacity)*1000), a, b, c, d, e, f)
	}
	return content.String()
}

func WriteOverlayPDF(output *os.File, pages []OverlayPage) error {
	if len(pages) == 0 {
		return errors.New("overlay requires at least one page")
	}
	if err := output.Truncate(0); err != nil {
		return err
	}
	if _, err := output.Seek(0, 0); err != nil {
		return err
	}
	opacities := map[int]int{}
	hasImage := false
	var image JPEGInput
	for _, page := range pages {
		for _, item := range page.Texts {
			opacities[int(math.Round(clampOpacity(item.Opacity)*1000))] = 0
		}
		if page.Image != nil {
			opacities[int(math.Round(clampOpacity(page.Image.Opacity)*1000))] = 0
			if !hasImage {
				hasImage, image = true, page.Image.Image
			}
		}
	}
	nextID := 4 + len(pages)*2
	for opacity := range opacities {
		opacities[opacity] = nextID
		nextID++
	}
	imageID := 0
	if hasImage {
		imageID = nextID
		nextID++
	}
	writer := &pdfWriter{file: output, offsets: make([]int64, nextID)}
	writer.write("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	writer.startObject(1)
	writer.write("<< /Type /Catalog /Pages 2 0 R >>")
	writer.endObject()
	writer.startObject(2)
	kids := make([]string, len(pages))
	for index := range pages {
		kids[index] = fmt.Sprintf("%d 0 R", 4+index*2)
	}
	writer.write(fmt.Sprintf("<< /Type /Pages /Count %d /Kids [%s] >>", len(pages), strings.Join(kids, " ")))
	writer.endObject()
	writer.startObject(3)
	writer.write("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
	writer.endObject()
	for index, page := range pages {
		if page.Width <= 0 || page.Height <= 0 {
			return errors.New("overlay page dimensions must be positive")
		}
		pageID, contentID := 4+index*2, 5+index*2
		var resources strings.Builder
		resources.WriteString("<< /Font << /F1 3 0 R >> /ExtGState <<")
		for opacity, id := range opacities {
			fmt.Fprintf(&resources, " /GS%d %d 0 R", opacity, id)
		}
		resources.WriteString(" >>")
		if hasImage {
			fmt.Fprintf(&resources, " /XObject << /Im0 %d 0 R >>", imageID)
		}
		resources.WriteString(" >>")
		content := overlayContent(page)
		writer.startObject(pageID)
		writer.write(fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.3f %.3f] /Resources %s /Contents %d 0 R >>", page.Width, page.Height, resources.String(), contentID))
		writer.endObject()
		writer.startObject(contentID)
		writer.write(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(content), content))
		writer.endObject()
	}
	for opacity, id := range opacities {
		writer.startObject(id)
		writer.write(fmt.Sprintf("<< /Type /ExtGState /ca %.3f /CA %.3f >>", float64(opacity)/1000, float64(opacity)/1000))
		writer.endObject()
	}
	if hasImage {
		stat, err := os.Stat(image.Path)
		if err != nil {
			return err
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
		return writer.err
	}
	xref, err := output.Seek(0, 1)
	if err != nil {
		return err
	}
	writer.write(fmt.Sprintf("xref\n0 %d\n0000000000 65535 f \n", nextID))
	for id := 1; id < nextID; id++ {
		writer.write(fmt.Sprintf("%010d 00000 n \n", writer.offsets[id]))
	}
	writer.write(fmt.Sprintf("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", nextID, xref))
	if writer.err != nil {
		return writer.err
	}
	return output.Sync()
}
