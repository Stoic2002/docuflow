package httpapi

import "testing"

func TestValidateJPEGMetadata(t *testing.T) {
	tests := []struct {
		name        string
		filename    string
		contentType string
		wantError   bool
	}{
		{name: "jpg", filename: "photo.jpg", contentType: "image/jpeg"},
		{name: "jpeg case insensitive", filename: "PHOTO.JPEG", contentType: "application/octet-stream"},
		{name: "browser MIME parameters", filename: "photo.jpg", contentType: "image/jpeg; name=photo.jpg"},
		{name: "wrong extension", filename: "photo.png", contentType: "image/jpeg", wantError: true},
		{name: "wrong MIME", filename: "photo.jpg", contentType: "image/png", wantError: true},
		{name: "newline", filename: "photo\n.jpg", contentType: "image/jpeg", wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := validateJPEGMetadata(test.filename, test.contentType)
			if (err != nil) != test.wantError {
				t.Fatalf("validateJPEGMetadata() error = %v, wantError %v", err, test.wantError)
			}
		})
	}
}
