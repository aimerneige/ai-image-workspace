package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func tinyPNG(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestValidateOpenAISize(t *testing.T) {
	cases := []struct {
		model, size string
		ok          bool
	}{
		{"gpt-image-2", "auto", true},
		{"gpt-image-2", "1024x1024", true},
		{"gpt-image-2", "1536x864", true},
		{"gpt-image-2", "3840x2160", true},
		{"gpt-image-2", "1000x1000", false}, // not /16
		{"gpt-image-2", "4096x2048", false}, // edge > 3840
		{"gpt-image-2", "2880x768", false},  // ratio > 3
		{"gpt-image-2", "512x512", false},   // too few pixels
		{"gpt-image-2", "3840x3840", false}, // too many pixels
		{"gpt-image-2", "big", false},
		{"gpt-image-1.5", "1536x1024", true},
	}
	for _, c := range cases {
		err := ValidateOpenAISize(c.model, c.size)
		if (err == nil) != c.ok {
			t.Errorf("%s %s: got err=%v, want ok=%v", c.model, c.size, err, c.ok)
		}
	}
}

func TestOpenAIGenerate(t *testing.T) {
	img := tinyPNG(t)
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer sk-test" {
			http.Error(w, "bad", 400)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"data":  []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(img)}, map[string]any{"b64_json": base64.StdEncoding.EncodeToString(img)}},
			"usage": map[string]any{"total_tokens": 42},
			"size":  "1536x864",
		})
	}))
	defer srv.Close()

	c, _ := New(Options{Type: "openai", BaseURL: srv.URL + "/v1", APIKey: "sk-test"})
	comp := 80
	res, err := c.Generate(context.Background(), Request{
		Model: "gpt-image-2", Prompt: "1234",
		Params: Params{N: 2, Size: "1536x864", Quality: "high", OutputFormat: "webp", OutputCompression: &comp, InputFidelity: "high"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Images) != 2 || res.Images[0].Mime != "image/png" {
		t.Fatalf("unexpected images: %+v", res.Images)
	}
	// Numeric prompt must remain a string; n must be a number.
	if got["prompt"] != "1234" || got["n"] != float64(2) || got["output_compression"] != float64(80) {
		t.Fatalf("bad request body: %#v", got)
	}
	if _, ok := got["input_fidelity"]; ok {
		t.Fatal("input_fidelity must not be sent on generations")
	}
	if res.Meta["size"] != "1536x864" || res.Meta["usage"] == nil {
		t.Fatalf("meta not captured: %#v", res.Meta)
	}
}

func TestOpenAIEditMultipart(t *testing.T) {
	img := tinyPNG(t)
	var files int
	var fidelity string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/images/edits" {
			http.Error(w, "wrong path", 404)
			return
		}
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		files = len(r.MultipartForm.File["image[]"])
		fidelity = r.FormValue("input_fidelity")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(img)}}})
	}))
	defer srv.Close()

	c, _ := New(Options{Type: "openai", BaseURL: srv.URL + "/v1", APIKey: "k"})
	req := Request{Model: "gpt-image-1.5", Prompt: "edit", Params: Params{N: 1, InputFidelity: "high"},
		Images: []InputImage{{Data: img, Mime: "image/png"}, {Data: img, Mime: "image/png"}}}
	res, err := c.Generate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	if files != 2 || fidelity != "high" {
		t.Fatalf("files=%d fidelity=%q", files, fidelity)
	}
	logged, _ := json.Marshal(res.RequestLog)
	if bytes.Contains(logged, []byte(base64.StdEncoding.EncodeToString(img))) || !strings.Contains(string(logged), "bytes omitted") {
		t.Fatalf("request log must not contain image bytes: %s", logged)
	}

	// gpt-image-2 must not receive input_fidelity.
	req.Model = "gpt-image-2"
	if _, err := c.Generate(context.Background(), req); err != nil {
		t.Fatal(err)
	}
	if fidelity != "" {
		t.Fatalf("input_fidelity sent to gpt-image-2: %q", fidelity)
	}
}

func TestOpenAIUpstreamError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		_, _ = io.WriteString(w, `{"error":{"message":"Your request was rejected","code":"moderation_blocked"}}`)
	}))
	defer srv.Close()
	c, _ := New(Options{Type: "openai", BaseURL: srv.URL, APIKey: "k"})
	_, err := c.Generate(context.Background(), Request{Model: "gpt-image-2", Prompt: "x", Params: Params{N: 1}})
	var pe *Error
	if !errors.As(err, &pe) || pe.Status != 400 || pe.Message != "Your request was rejected" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestOpenAIValidation(t *testing.T) {
	c, _ := New(Options{Type: "openai", APIKey: "k"})
	bad := []Params{
		{N: 0},
		{N: 11},
		{N: 1, Quality: "ultra"},
		{N: 1, Background: "transparent", OutputFormat: "jpeg"},
	}
	for _, p := range bad {
		if err := c.Validate(Request{Model: "gpt-image-2", Prompt: "x", Params: p}); !errors.Is(err, ErrInvalid) {
			t.Errorf("params %+v: expected ErrInvalid, got %v", p, err)
		}
	}
}

func TestGeminiGenerate(t *testing.T) {
	img := tinyPNG(t)
	calls := 0
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/v1beta/models/gemini-3-pro-image:generateContent" || r.Header.Get("x-goog-api-key") != "g-key" {
			http.Error(w, "bad "+r.URL.Path, 400)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"candidates": []any{map[string]any{
				"content": map[string]any{"parts": []any{
					map[string]any{"text": "thinking...", "thought": true},
					map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(img)}, "thought": true},
					map[string]any{"text": "Here you go"},
					map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(img)}},
				}},
				"finishReason": "STOP",
			}},
			"usageMetadata": map[string]any{"totalTokenCount": 10},
		})
	}))
	defer srv.Close()

	c, _ := New(Options{Type: "gemini", BaseURL: srv.URL, APIKey: "g-key"})
	res, err := c.Generate(context.Background(), Request{
		Model: "gemini-3-pro-image", Prompt: "city",
		Images: []InputImage{{Data: img, Mime: "image/png"}},
		Params: Params{N: 2, AspectRatio: "16:9", ImageSize: "2K", GoogleSearch: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 2 || len(res.Images) != 2 {
		t.Fatalf("calls=%d images=%d (thought images must be skipped)", calls, len(res.Images))
	}
	if !strings.Contains(res.Text, "Here you go") || strings.Contains(res.Text, "thinking") {
		t.Fatalf("unexpected text %q", res.Text)
	}
	gc := body["generationConfig"].(map[string]any)
	ic := gc["imageConfig"].(map[string]any)
	if ic["aspectRatio"] != "16:9" || ic["imageSize"] != "2K" || body["tools"] == nil {
		t.Fatalf("bad gemini body: %#v", body)
	}
}

func TestGeminiBlockedAndLegacyImageSize(t *testing.T) {
	var body map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&body)
		_, _ = io.WriteString(w, `{"promptFeedback":{"blockReason":"SAFETY"}}`)
	}))
	defer srv.Close()
	c, _ := New(Options{Type: "gemini", BaseURL: srv.URL + "/v1beta", APIKey: "k"})
	_, err := c.Generate(context.Background(), Request{Model: "gemini-2.5-flash-image", Prompt: "x", Params: Params{N: 1, ImageSize: "2K"}})
	if err == nil || !strings.Contains(err.Error(), "SAFETY") {
		t.Fatalf("expected blocked error, got %v", err)
	}
	if gc, ok := body["generationConfig"].(map[string]any); ok {
		if _, has := gc["imageConfig"]; has {
			t.Fatal("imageSize must not be sent to gemini-2.5-flash-image")
		}
	}
}
