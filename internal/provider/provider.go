// Package provider implements upstream image model APIs.
package provider

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Params is the union of every tunable exposed in the UI. Each provider
// validates and uses the subset it understands.
type Params struct {
	N int `json:"n,omitempty"`

	// OpenAI (gpt-image family)
	Size              string `json:"size,omitempty"`
	Quality           string `json:"quality,omitempty"`
	Background        string `json:"background,omitempty"`
	OutputFormat      string `json:"output_format,omitempty"`
	OutputCompression *int   `json:"output_compression,omitempty"`
	Moderation        string `json:"moderation,omitempty"`
	InputFidelity     string `json:"input_fidelity,omitempty"`

	// Gemini (Nano Banana family)
	AspectRatio  string   `json:"aspect_ratio,omitempty"`
	ImageSize    string   `json:"image_size,omitempty"`
	GoogleSearch bool     `json:"google_search,omitempty"`
	Temperature  *float64 `json:"temperature,omitempty"`
}

type InputImage struct {
	Data []byte
	Mime string
	Name string
}

type Request struct {
	Model  string
	Prompt string
	Images []InputImage
	Params Params
}

type OutputImage struct {
	Data []byte
	Mime string
}

type Result struct {
	Images []OutputImage
	// Text is any textual answer from the model (Gemini can reply with text).
	Text string
	// Meta carries usage and other upstream metadata for the history view.
	Meta map[string]any
	// RequestLog is the upstream request with binary data stripped.
	RequestLog any
}

type Client interface {
	// Validate checks parameters without contacting the upstream.
	Validate(req Request) error
	Generate(ctx context.Context, req Request) (*Result, error)
	// Test performs a cheap authenticated call to verify credentials.
	Test(ctx context.Context) error
}

type Options struct {
	Type    string
	BaseURL string
	APIKey  string
	HTTP    *http.Client
}

func New(o Options) (Client, error) {
	if o.HTTP == nil {
		o.HTTP = &http.Client{Timeout: 0} // per-request deadlines come from ctx
	}
	switch o.Type {
	case "openai":
		return newOpenAI(o), nil
	case "gemini":
		return newGemini(o), nil
	}
	return nil, fmt.Errorf("unknown provider type %q", o.Type)
}

// Error is returned for non-2xx upstream responses.
type Error struct {
	Status  int
	Message string
	Body    string
}

func (e *Error) Error() string {
	if e.Message != "" {
		return fmt.Sprintf("upstream %d: %s", e.Status, e.Message)
	}
	return fmt.Sprintf("upstream %d", e.Status)
}

// ErrInvalid marks request validation errors (user-fixable).
var ErrInvalid = errors.New("invalid request")

func invalidf(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

func readUpstreamError(resp *http.Response) error {
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	e := &Error{Status: resp.StatusCode, Body: string(body)}
	var parsed struct {
		Error json.RawMessage `json:"error"`
	}
	if json.Unmarshal(body, &parsed) == nil && len(parsed.Error) > 0 {
		var obj struct {
			Message string `json:"message"`
			Code    any    `json:"code"`
			Status  string `json:"status"`
		}
		if json.Unmarshal(parsed.Error, &obj) == nil && obj.Message != "" {
			e.Message = obj.Message
		} else {
			var s string
			if json.Unmarshal(parsed.Error, &s) == nil {
				e.Message = s
			}
		}
	}
	if e.Message == "" {
		msg := strings.TrimSpace(string(body))
		if len(msg) > 300 {
			msg = msg[:300] + "…"
		}
		if msg == "" {
			msg = http.StatusText(resp.StatusCode)
		}
		e.Message = msg
	}
	return e
}

func joinURL(base, path string) string {
	return strings.TrimRight(base, "/") + path
}

func omitted(n int) string { return fmt.Sprintf("<%d bytes omitted>", n) }

func since(t time.Time) int64 { return time.Since(t).Milliseconds() }
