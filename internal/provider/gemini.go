package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const DefaultGeminiBaseURL = "https://generativelanguage.googleapis.com"

type gemini struct {
	base string
	key  string
	http *http.Client
	// bearer also sends the key as "Authorization: Bearer". Relays such as
	// 302.AI only accept that form; Google's own endpoint must not receive
	// it because it would be interpreted as an OAuth token.
	bearer bool
}

func (c *gemini) auth(req *http.Request) {
	req.Header.Set("x-goog-api-key", c.key)
	if c.bearer {
		req.Header.Set("Authorization", "Bearer "+c.key)
	}
}

func isGoogleHost(base string) bool {
	u, err := url.Parse(base)
	if err != nil {
		return false
	}
	h := strings.ToLower(u.Hostname())
	return h == "googleapis.com" || strings.HasSuffix(h, ".googleapis.com")
}

func newGemini(o Options) *gemini {
	base := strings.TrimRight(o.BaseURL, "/")
	if base == "" {
		base = DefaultGeminiBaseURL
	}
	if !strings.HasSuffix(base, "/v1beta") && !strings.HasSuffix(base, "/v1") && !strings.HasSuffix(base, "/v1alpha") {
		base += "/v1beta"
	}
	return &gemini{base: base, key: o.APIKey, http: o.HTTP, bearer: !isGoogleHost(base)}
}

var geminiRatios = []string{"1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"}

// GeminiSupportsImageSize reports whether the model accepts imageConfig.imageSize
// (Nano Banana Pro and Nano Banana 2 do; the original Nano Banana does not).
func GeminiSupportsImageSize(model string) bool {
	return !strings.Contains(model, "2.5-flash-image") && !strings.Contains(model, "2.0-flash")
}

func (c *gemini) Validate(req Request) error {
	p := req.Params
	if strings.TrimSpace(req.Prompt) == "" {
		return invalidf("prompt is required")
	}
	if p.N < 1 || p.N > 4 {
		return invalidf("n must be between 1 and 4")
	}
	if len(req.Images) > 14 {
		return invalidf("at most 14 reference images are supported")
	}
	if p.AspectRatio != "" && p.AspectRatio != "auto" {
		if err := oneOf("aspect_ratio", p.AspectRatio, geminiRatios...); err != nil {
			return err
		}
	}
	if err := oneOf("image_size", p.ImageSize, "1K", "2K", "4K"); err != nil {
		return err
	}
	if p.Temperature != nil && (*p.Temperature < 0 || *p.Temperature > 2) {
		return invalidf("temperature must be between 0 and 2")
	}
	return nil
}

type gPart struct {
	Text       string   `json:"text,omitempty"`
	InlineData *gInline `json:"inline_data,omitempty"`
}

type gInline struct {
	MimeType string `json:"mime_type"`
	Data     string `json:"data"`
}

func (c *gemini) body(req Request, forLog bool) map[string]any {
	parts := []gPart{{Text: req.Prompt}}
	for _, img := range req.Images {
		data := omitted(len(img.Data))
		if !forLog {
			data = base64.StdEncoding.EncodeToString(img.Data)
		}
		parts = append(parts, gPart{InlineData: &gInline{MimeType: img.Mime, Data: data}})
	}
	p := req.Params
	imageCfg := map[string]any{}
	if p.AspectRatio != "" && p.AspectRatio != "auto" {
		imageCfg["aspectRatio"] = p.AspectRatio
	}
	if p.ImageSize != "" && GeminiSupportsImageSize(req.Model) {
		imageCfg["imageSize"] = p.ImageSize
	}
	gen := map[string]any{"responseModalities": []string{"TEXT", "IMAGE"}}
	if len(imageCfg) > 0 {
		gen["imageConfig"] = imageCfg
	}
	if p.Temperature != nil {
		gen["temperature"] = *p.Temperature
	}
	body := map[string]any{
		"contents":         []map[string]any{{"role": "user", "parts": parts}},
		"generationConfig": gen,
	}
	if p.GoogleSearch {
		body["tools"] = []map[string]any{{"google_search": map[string]any{}}}
	}
	return body
}

type gResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text       string `json:"text"`
				Thought    bool   `json:"thought"`
				InlineData *struct {
					MimeType string `json:"mimeType"`
					Data     string `json:"data"`
				} `json:"inlineData"`
			} `json:"parts"`
		} `json:"content"`
		FinishReason      string `json:"finishReason"`
		FinishMessage     string `json:"finishMessage"`
		GroundingMetadata any    `json:"groundingMetadata"`
	} `json:"candidates"`
	PromptFeedback *struct {
		BlockReason        string `json:"blockReason"`
		BlockReasonMessage string `json:"blockReasonMessage"`
	} `json:"promptFeedback"`
	UsageMetadata any    `json:"usageMetadata"`
	ModelVersion  string `json:"modelVersion"`
	ResponseID    string `json:"responseId"`
}

type gCallResult struct {
	images  []OutputImage
	text    string
	meta    map[string]any
	elapsed int64
}

func (c *gemini) call(ctx context.Context, model string, payload []byte) (*gCallResult, error) {
	start := time.Now()
	u := fmt.Sprintf("%s/models/%s:generateContent", c.base, url.PathEscape(model))
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	c.auth(httpReq)
	resp, err := c.http.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, readUpstreamError(resp)
	}
	var out gResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 512<<20)).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode upstream response: %w", err)
	}
	r := &gCallResult{meta: map[string]any{}, elapsed: since(start)}
	var texts []string
	var finish []string
	for _, cand := range out.Candidates {
		for _, part := range cand.Content.Parts {
			if part.Thought {
				continue // interim "thinking" images/text from Nano Banana Pro
			}
			if part.InlineData != nil && part.InlineData.Data != "" {
				data, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
				if err != nil {
					return nil, fmt.Errorf("decode image: %w", err)
				}
				r.images = append(r.images, OutputImage{Data: data, Mime: part.InlineData.MimeType})
			} else if t := strings.TrimSpace(part.Text); t != "" {
				texts = append(texts, t)
			}
		}
		if cand.FinishReason != "" {
			finish = append(finish, cand.FinishReason)
		}
		if cand.GroundingMetadata != nil {
			r.meta["grounding"] = cand.GroundingMetadata
		}
		if cand.FinishMessage != "" {
			r.meta["finish_message"] = cand.FinishMessage
		}
	}
	r.text = strings.Join(texts, "\n\n")
	if out.UsageMetadata != nil {
		r.meta["usage"] = out.UsageMetadata
	}
	if out.ModelVersion != "" {
		r.meta["model_version"] = out.ModelVersion
	}
	if len(finish) > 0 {
		r.meta["finish_reason"] = strings.Join(finish, ",")
	}
	if len(r.images) == 0 {
		reason := ""
		if out.PromptFeedback != nil && out.PromptFeedback.BlockReason != "" {
			reason = "prompt blocked: " + out.PromptFeedback.BlockReason
			if out.PromptFeedback.BlockReasonMessage != "" {
				reason += " (" + out.PromptFeedback.BlockReasonMessage + ")"
			}
		} else if len(finish) > 0 && finish[0] != "STOP" {
			reason = "finish reason: " + strings.Join(finish, ",")
			if m, ok := r.meta["finish_message"].(string); ok {
				reason += " — " + m
			}
		}
		if reason == "" {
			reason = "model returned no image"
		}
		if r.text != "" {
			reason += ". Model said: " + truncate(r.text, 600)
		}
		return r, errors.New(reason)
	}
	return r, nil
}

// Generate issues N parallel requests: Gemini returns one image per call.
func (c *gemini) Generate(ctx context.Context, req Request) (*Result, error) {
	if err := c.Validate(req); err != nil {
		return nil, err
	}
	logBody := c.body(req, true)
	logBody["_endpoint"] = fmt.Sprintf("POST /models/%s:generateContent", req.Model)
	if req.Params.N > 1 {
		logBody["_parallel_requests"] = req.Params.N
	}
	payload, err := json.Marshal(c.body(req, false))
	if err != nil {
		return nil, err
	}

	n := req.Params.N
	results := make([]*gCallResult, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = c.call(ctx, req.Model, payload)
		}(i)
	}
	wg.Wait()

	res := &Result{RequestLog: logBody, Meta: map[string]any{}}
	var texts []string
	var calls []map[string]any
	var firstErr error
	for i := 0; i < n; i++ {
		call := map[string]any{}
		if r := results[i]; r != nil {
			res.Images = append(res.Images, r.images...)
			if r.text != "" {
				texts = append(texts, r.text)
			}
			for k, v := range r.meta {
				call[k] = v
			}
			call["elapsed_ms"] = r.elapsed
		}
		if errs[i] != nil {
			call["error"] = errs[i].Error()
			if firstErr == nil {
				firstErr = errs[i]
			}
		}
		calls = append(calls, call)
	}
	if n == 1 {
		res.Meta = calls[0]
		delete(res.Meta, "error")
	} else {
		res.Meta["calls"] = calls
	}
	res.Text = strings.Join(texts, "\n\n---\n\n")
	if len(res.Images) == 0 {
		if firstErr == nil {
			firstErr = errors.New("model returned no image")
		}
		return res, firstErr
	}
	if firstErr != nil {
		res.Meta["partial_failure"] = firstErr.Error()
	}
	return res, nil
}

func (c *gemini) Test(ctx context.Context, model string) error {
	if model == "" {
		model = "gemini-3-pro-image"
	}
	list := func() (*http.Request, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/models?pageSize=1", nil)
		if err == nil {
			c.auth(req)
		}
		return req, err
	}
	// Empty contents: rejected with 400 before anything is generated.
	gen := func() (*http.Request, error) {
		u := fmt.Sprintf("%s/models/%s:generateContent", c.base, url.PathEscape(model))
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, u, strings.NewReader(`{"contents":[]}`))
		if err == nil {
			c.auth(req)
			req.Header.Set("Content-Type", "application/json")
		}
		return req, err
	}
	return probe(c.http, list, gen)
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
