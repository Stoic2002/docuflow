package processing

import (
	"reflect"
	"testing"
)

func TestParseOCRLanguageOutput(t *testing.T) {
	output := "List of available languages in \"/opt/homebrew/share/tessdata/\" (3):\neng\nind\nosd\n"
	got := parseOCRLanguageOutput(output)
	want := []string{"eng", "ind", "osd"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseOCRLanguageOutput() = %#v, want %#v", got, want)
	}
}
