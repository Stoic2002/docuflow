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

// maxShapePoints bounds a single freehand stroke so an oversized editor payload
// cannot inflate a content stream without limit.
const maxShapePoints = 4096

type PageSize struct {
	Width  float64
	Height float64
}

// RGB holds device colour components in the 0..1 range PDF operators expect.
// The zero value is black, so existing callers keep their previous output.
type RGB struct {
	R float64
	G float64
	B float64
}

type Point struct {
	X float64
	Y float64
}

type TextOverlay struct {
	Text     string
	X        float64
	Y        float64
	FontSize float64
	Opacity  float64
	Rotation float64
	Align    string
	Color    RGB
	// Font is a FontRegistry id. Empty selects the built-in Helvetica.
	Font string
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

type ShapeKind string

const (
	ShapeRectangle ShapeKind = "rectangle"
	ShapeEllipse   ShapeKind = "ellipse"
	ShapeLine      ShapeKind = "line"
	ShapePolyline  ShapeKind = "polyline"
)

// ShapeOverlay draws vector geometry. Rectangle and ellipse read Points as two
// opposite corners of their bounding box; line and polyline read Points as the
// path itself. A nil Fill leaves the interior untouched.
type ShapeOverlay struct {
	Kind        ShapeKind
	Points      []Point
	Stroke      RGB
	StrokeWidth float64
	Fill        *RGB
	Opacity     float64
	Rotation    float64
}

type OverlayPage struct {
	PageSize
	Texts  []TextOverlay
	Images []ImageOverlay
	Shapes []ShapeOverlay
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
		return nil, errors.New("PDF document dimensions are unavailable")
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

func clampComponent(value float64) float64 {
	if value < 0 || math.IsNaN(value) {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}

// colorOperator renders a colour with the requested operator: "rg" fills and
// "RG" strokes.
func colorOperator(color RGB, operator string) string {
	return fmt.Sprintf("%.4f %.4f %.4f %s", clampComponent(color.R), clampComponent(color.G), clampComponent(color.B), operator)
}

func clampStrokeWidth(value float64) float64 {
	if value < 0.1 {
		return 0.1
	}
	if value > 72 {
		return 72
	}
	return value
}

func opacityKey(value float64) int { return int(math.Round(clampOpacity(value) * 1000)) }

// rotationMatrix builds a cm transform that rotates around an anchor point
// rather than the page origin.
func rotationMatrix(degrees, anchorX, anchorY float64) string {
	angle := degrees * math.Pi / 180
	cosine, sine := math.Cos(angle), math.Sin(angle)
	return fmt.Sprintf("%.6f %.6f %.6f %.6f %.3f %.3f cm",
		cosine, sine, -sine, cosine,
		anchorX-cosine*anchorX+sine*anchorY,
		anchorY-sine*anchorX-cosine*anchorY)
}

func boundingBox(points []Point) (minX, minY, maxX, maxY float64) {
	minX, minY = points[0].X, points[0].Y
	maxX, maxY = points[0].X, points[0].Y
	for _, point := range points[1:] {
		minX, maxX = math.Min(minX, point.X), math.Max(maxX, point.X)
		minY, maxY = math.Min(minY, point.Y), math.Max(maxY, point.Y)
	}
	return minX, minY, maxX, maxY
}

func validateShape(shape ShapeOverlay) error {
	switch shape.Kind {
	case ShapeRectangle, ShapeEllipse, ShapeLine:
		if len(shape.Points) != 2 {
			return fmt.Errorf("%s requires exactly two points", shape.Kind)
		}
	case ShapePolyline:
		if len(shape.Points) < 2 {
			return errors.New("polyline requires at least two points")
		}
	default:
		return fmt.Errorf("unsupported shape %q", shape.Kind)
	}
	if len(shape.Points) > maxShapePoints {
		return fmt.Errorf("shape exceeds %d points", maxShapePoints)
	}
	for _, point := range shape.Points {
		if math.IsNaN(point.X) || math.IsNaN(point.Y) || math.IsInf(point.X, 0) || math.IsInf(point.Y, 0) {
			return errors.New("shape points must be finite")
		}
	}
	return nil
}

// paintOperator picks the PDF painting operator for the requested fill and
// stroke combination. Open paths are only ever stroked.
func paintOperator(shape ShapeOverlay, closed bool) string {
	filled := closed && shape.Fill != nil
	stroked := shape.StrokeWidth > 0
	switch {
	case filled && stroked:
		return "B"
	case filled:
		return "f"
	case stroked:
		return "S"
	default:
		return "n"
	}
}

// ellipsePath approximates an ellipse with the four cubic Béziers that the
// standard kappa constant makes visually exact.
func ellipsePath(centerX, centerY, radiusX, radiusY float64) string {
	const kappa = 0.5522847498
	offsetX, offsetY := radiusX*kappa, radiusY*kappa
	var path strings.Builder
	fmt.Fprintf(&path, "%.3f %.3f m\n", centerX+radiusX, centerY)
	fmt.Fprintf(&path, "%.3f %.3f %.3f %.3f %.3f %.3f c\n", centerX+radiusX, centerY+offsetY, centerX+offsetX, centerY+radiusY, centerX, centerY+radiusY)
	fmt.Fprintf(&path, "%.3f %.3f %.3f %.3f %.3f %.3f c\n", centerX-offsetX, centerY+radiusY, centerX-radiusX, centerY+offsetY, centerX-radiusX, centerY)
	fmt.Fprintf(&path, "%.3f %.3f %.3f %.3f %.3f %.3f c\n", centerX-radiusX, centerY-offsetY, centerX-offsetX, centerY-radiusY, centerX, centerY-radiusY)
	fmt.Fprintf(&path, "%.3f %.3f %.3f %.3f %.3f %.3f c\n", centerX+offsetX, centerY-radiusY, centerX+radiusX, centerY-offsetY, centerX+radiusX, centerY)
	return path.String()
}

func shapeContent(shape ShapeOverlay) string {
	var content strings.Builder
	minX, minY, maxX, maxY := boundingBox(shape.Points)
	centerX, centerY := (minX+maxX)/2, (minY+maxY)/2
	fmt.Fprintf(&content, "q /GS%d gs\n", opacityKey(shape.Opacity))
	if shape.Rotation != 0 {
		fmt.Fprintf(&content, "%s\n", rotationMatrix(shape.Rotation, centerX, centerY))
	}
	if shape.Fill != nil {
		fmt.Fprintf(&content, "%s\n", colorOperator(*shape.Fill, "rg"))
	}
	if shape.StrokeWidth > 0 {
		fmt.Fprintf(&content, "%s\n%.3f w\n1 J 1 j\n", colorOperator(shape.Stroke, "RG"), clampStrokeWidth(shape.StrokeWidth))
	}
	switch shape.Kind {
	case ShapeRectangle:
		fmt.Fprintf(&content, "%.3f %.3f %.3f %.3f re\n%s\n", minX, minY, maxX-minX, maxY-minY, paintOperator(shape, true))
	case ShapeEllipse:
		content.WriteString(ellipsePath(centerX, centerY, (maxX-minX)/2, (maxY-minY)/2))
		fmt.Fprintf(&content, "%s\n", paintOperator(shape, true))
	case ShapeLine, ShapePolyline:
		fmt.Fprintf(&content, "%.3f %.3f m\n", shape.Points[0].X, shape.Points[0].Y)
		for _, point := range shape.Points[1:] {
			fmt.Fprintf(&content, "%.3f %.3f l\n", point.X, point.Y)
		}
		fmt.Fprintf(&content, "%s\n", paintOperator(shape, false))
	}
	content.WriteString("Q\n")
	return content.String()
}

func textContent(text TextOverlay, font *resolvedFont) string {
	fontSize := text.FontSize
	if fontSize < 6 {
		fontSize = 6
	}
	if fontSize > 144 {
		fontSize = 144
	}
	x := text.X
	width := font.measure(text.Text, fontSize)
	if text.Align == "center" {
		x -= width / 2
	}
	if text.Align == "right" {
		x -= width
	}
	angle := text.Rotation * math.Pi / 180
	cosine, sine := math.Cos(angle), math.Sin(angle)
	return fmt.Sprintf("q /GS%d gs BT /%s %.3f Tf %s %.6f %.6f %.6f %.6f %.3f %.3f Tm %s ET Q\n",
		opacityKey(text.Opacity), font.resource, fontSize, colorOperator(text.Color, "rg"),
		cosine, sine, -sine, cosine, x, text.Y, font.show(text.Text))
}

func imageContent(image ImageOverlay, name string) string {
	angle := image.Rotation * math.Pi / 180
	cosine, sine := math.Cos(angle), math.Sin(angle)
	a, b := image.Width*cosine, image.Width*sine
	c, d := -image.Height*sine, image.Height*cosine
	e := image.CenterX - (a+c)/2
	f := image.CenterY - (b+d)/2
	return fmt.Sprintf("q /GS%d gs %.6f %.6f %.6f %.6f %.3f %.3f cm /%s Do Q\n",
		opacityKey(image.Opacity), a, b, c, d, e, f, name)
}

// overlayContent paints shapes first, then images, then text, so annotations
// read in the order an editor stacks them.
func overlayContent(page OverlayPage, imageNames map[string]string, fonts map[string]*resolvedFont) string {
	var content strings.Builder
	for _, shape := range page.Shapes {
		content.WriteString(shapeContent(shape))
	}
	for _, image := range page.Images {
		content.WriteString(imageContent(image, imageNames[image.Image.Path]))
	}
	for _, text := range page.Texts {
		content.WriteString(textContent(text, fonts[text.Font]))
	}
	return content.String()
}

// imageRegistry embeds each distinct source image once, however many pages
// place it.
type imageRegistry struct {
	order  []JPEGInput
	names  map[string]string
	object map[string]int
}

func collectImages(pages []OverlayPage) *imageRegistry {
	registry := &imageRegistry{names: map[string]string{}, object: map[string]int{}}
	for _, page := range pages {
		for _, image := range page.Images {
			if _, seen := registry.names[image.Image.Path]; seen {
				continue
			}
			registry.names[image.Image.Path] = fmt.Sprintf("Im%d", len(registry.order))
			registry.order = append(registry.order, image.Image)
		}
	}
	return registry
}

// WriteOverlayPDF draws with the built-in Helvetica only. Callers that need
// embedded fonts pass a registry to WriteOverlayPDFWithFonts.
func WriteOverlayPDF(output *os.File, pages []OverlayPage) error {
	return WriteOverlayPDFWithFonts(output, pages, nil)
}

func WriteOverlayPDFWithFonts(output *os.File, pages []OverlayPage, registry *FontRegistry) error {
	if len(pages) == 0 {
		return errors.New("overlay requires at least one page")
	}
	for _, page := range pages {
		for _, shape := range page.Shapes {
			if err := validateShape(shape); err != nil {
				return err
			}
		}
	}
	if err := output.Truncate(0); err != nil {
		return err
	}
	if _, err := output.Seek(0, 0); err != nil {
		return err
	}
	opacities := map[int]int{}
	for _, page := range pages {
		for _, item := range page.Texts {
			opacities[opacityKey(item.Opacity)] = 0
		}
		for _, item := range page.Shapes {
			opacities[opacityKey(item.Opacity)] = 0
		}
		for _, item := range page.Images {
			opacities[opacityKey(item.Opacity)] = 0
		}
	}
	fonts, embeddedFonts, err := resolveFonts(pages, registry)
	if err != nil {
		return err
	}
	images := collectImages(pages)
	nextID := 4 + len(pages)*2
	for opacity := range opacities {
		opacities[opacity] = nextID
		nextID++
	}
	for _, image := range images.order {
		images.object[image.Path] = nextID
		nextID++
	}
	fontIDs := make([]fontObjects, len(embeddedFonts))
	for index := range embeddedFonts {
		fontIDs[index] = fontObjects{typeZero: nextID, cidFont: nextID + 1, descriptor: nextID + 2, fontFile: nextID + 3, toUnicode: nextID + 4}
		nextID += objectsPerEmbeddedFont
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
		fmt.Fprintf(&resources, "<< /Font << /F1 3 0 R%s >> /ExtGState <<", pageFontObjects(page, fonts, embeddedFonts, fontIDs))
		for opacity, id := range opacities {
			fmt.Fprintf(&resources, " /GS%d %d 0 R", opacity, id)
		}
		resources.WriteString(" >>")
		if pageObjects := pageImageObjects(page, images); pageObjects != "" {
			fmt.Fprintf(&resources, " /XObject <<%s >>", pageObjects)
		}
		resources.WriteString(" >>")
		content := overlayContent(page, images.names, fonts)
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
	for _, image := range images.order {
		stat, err := os.Stat(image.Path)
		if err != nil {
			return err
		}
		decode := ""
		if image.ColorSpace == JPEGCMYK {
			decode = " /Decode [1 0 1 0 1 0 1 0]"
		}
		writer.startObject(images.object[image.Path])
		writer.write(fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /%s /BitsPerComponent 8 /Filter /DCTDecode /Length %d%s >>\nstream\n", image.Width, image.Height, image.ColorSpace, stat.Size(), decode))
		writer.copyFile(image.Path)
		writer.write("\nendstream")
		writer.endObject()
	}
	for index, entry := range embeddedFonts {
		if err := writeEmbeddedFont(writer, entry, fontIDs[index]); err != nil {
			return err
		}
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

// pageImageObjects lists only the XObjects a page actually draws.
func pageImageObjects(page OverlayPage, images *imageRegistry) string {
	var resources strings.Builder
	listed := map[string]bool{}
	for _, image := range page.Images {
		path := image.Image.Path
		if listed[path] {
			continue
		}
		listed[path] = true
		fmt.Fprintf(&resources, " /%s %d 0 R", images.names[path], images.object[path])
	}
	return resources.String()
}

// pageFontObjects lists the embedded fonts a page actually draws with, so a
// page that only uses Helvetica does not advertise every registered font.
func pageFontObjects(page OverlayPage, fonts map[string]*resolvedFont, embedded []*resolvedFont, ids []fontObjects) string {
	used := map[string]bool{}
	for _, text := range page.Texts {
		if resolved := fonts[text.Font]; resolved != nil && resolved.ttf != nil {
			used[resolved.resource] = true
		}
	}
	var resources strings.Builder
	for index, entry := range embedded {
		if used[entry.resource] {
			fmt.Fprintf(&resources, " /%s %d 0 R", entry.resource, ids[index].typeZero)
		}
	}
	return resources.String()
}
