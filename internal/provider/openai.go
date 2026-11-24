package provider

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"regexp"
	"strconv"
	"strings"
)

const DefaultOpenAIBaseURL = "https://api.openai.com/v1"

type openAI struct {
	base string
	key  string
	http *http.Client
}

func newOpenAI(o Options) *openAI {
	base := o.BaseURL
	if base == "" {
		base = DefaultOpenAIBaseURL
	}
	return &openAI{base: base, key: o.APIKey, http: o.HTTP}
}

var sizeRe = regexp.MustCompile(`^(\d{2,5})x(\d{2,5})$`)

// ValidateOpenAISize applies the gpt-image-2 sizing rules: both edges
// divisible by 16, aspect ratio within 1:3..3:1, edge <= 3840 and total
// pixels within [655360, 8294400].
func ValidateOpenAISize(model, size string) error {
	if size == "" || size == "auto" {
		return nil
	}
	m := sizeRe.FindStringSubmatch(size)
	if m == nil {
		return invalidf("size must be auto or WIDTHxHEIGHT")
	}
	if !strings.HasPrefix(model, "gpt-image-2") {
		return nil // upstream validates fixed-size models
	}
	w, _ := strconv.Atoi(m[1])
	h, _ := strconv.Atoi(m[2])
	switch {
	case w%16 != 0 || h%16 != 0:
		return invalidf("width and height must be multiples of 16")
	case max(w, h) > 3840:
		return invalidf("longest edge must be at most 3840px")
	case float64(max(w, h))/float64(min(w, h)) > 3:
		return invalidf("aspect ratio must be between 1:3 and 3:1")
	case w*h < 655360 || w*h > 8294400:
		return invalidf("total pixels must be between 655,360 and 8,294,400")
	}
	return nil
}

func oneOf(field, v string, allowed ...string) error {
	if v == "" {
		return nil
	}
	for _, a := range allowed {
		if v == a {
			return nil
		}
	}
	return invalidf("%s must be one of %s", field, strings.Join(allowed, ", "))
}

func (c *openAI) Validate(req Request) error {
	p := req.Params
	if strings.TrimSpace(req.Prompt) == "" {
		return invalidf("prompt is required")
	}
	if len([]rune(req.Prompt)) > 32000 {
		return invalidf("prompt is longer than 32000 characters")
	}
	if p.N < 1 || p.N > 10 {
		return invalidf("n must be between 1 and 10")
	}
	if len(req.Images) > 16 {
		return invalidf("at most 16 reference images are supported")
	}
	if err := ValidateOpenAISize(req.Model, p.Size); err != nil {
		return err
	}
	for _, chk := range []error{
		oneOf("quality", p.Quality, "auto", "low", "medium", "high", "xhigh", "max"),
		oneOf("background", p.Background, "auto", "opaque", "transparent"),
		oneOf("output_format", p.OutputFormat, "png", "jpeg", "webp"),
		oneOf("moderation", p.Moderation, "auto", "low"),
		oneOf("input_fidelity", p.InputFidelity, "low", "high"),
	} {
		if chk != nil {
			return chk
		}
	}
	if p.Background == "transparent" && p.OutputFormat == "jpeg" {
		return invalidf("transparent background requires png or webp output")
	}
	if p.OutputCompression != nil && (*p.OutputCompression < 0 || *p.OutputCompression > 100) {
		return invalidf("output_compression must be between 0 and 100")
	}
	return nil
}

// fields returns the request parameters in a stable order, omitting unset
// values so relays with partial support are not tripped up.
func (c *openAI) fields(req Request, edit bool) [][2]string {
	p := req.Params
	f := [][2]string{{"model", req.Model}, {"prompt", req.Prompt}, {"n", strconv.Itoa(p.N)}}
	add := func(k, v string) {
		if v != "" {
			f = append(f, [2]string{k, v})
		}
	}
	add("size", p.Size)
	add("quality", p.Quality)
	add("background", p.Background)
	add("output_format", p.OutputFormat)
	if p.OutputCompression != nil && (p.OutputFormat == "jpeg" || p.OutputFormat == "webp") {
		add("output_compression", strconv.Itoa(*p.OutputCompression))
	}
	add("moderation", p.Moderation)
	// gpt-image-2 rejects input_fidelity; only send it to models that take it.
	if edit && p.InputFidelity != "" && !strings.HasPrefix(req.Model, "gpt-image-2") {
		add("input_fidelity", p.InputFidelity)
	}
	return f
}

func (c *openAI) Generate(ctx context.Context, req Request) (*Result, error) {
	if err := c.Validate(req); err != nil {
		return nil, err
	}
	edit := len(req.Images) > 0
	fields := c.fields(req, edit)

	var (
		httpReq *http.Request
		err     error
		logBody = map[string]any{}
	)
	for _, kv := range fields {
		logBody[kv[0]] = typed(kv[0], kv[1])
	}
	if !edit {
		body := map[string]any{}
		for _, kv := range fields {
			body[kv[0]] = typed(kv[0], kv[1])
		}
		buf, _ := json.Marshal(body)
		logBody["_endpoint"] = "POST /images/generations"
		httpReq, err = http.NewRequestWithContext(ctx, http.MethodPost, joinURL(c.base, "/images/generations"), bytes.NewReader(buf))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
	} else {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		for _, kv := range fields {
			_ = mw.WriteField(kv[0], kv[1])
		}
		var imgLog []map[string]any
		for i, img := range req.Images {
			name := img.Name
			if name == "" {
				name = fmt.Sprintf("image-%d%s", i+1, extFor(img.Mime))
			}
			h := textproto.MIMEHeader{}
			h.Set("Content-Disposition", fmt.Sprintf(`form-data; name="image[]"; filename="%s"`, escapeQuotes(name)))
			h.Set("Content-Type", img.Mime)
			w, err := mw.CreatePart(h)
			if err != nil {
				return nil, err
			}
			if _, err := w.Write(img.Data); err != nil {
				return nil, err
			}
			imgLog = append(imgLog, map[string]any{"filename": name, "mime": img.Mime, "data": omitted(len(img.Data))})
		}
		if err := mw.Close(); err != nil {
			return nil, err
		}
		logBody["image[]"] = imgLog
		logBody["_endpoint"] = "POST /images/edits (multipart)"
		httpReq, err = http.NewRequestWithContext(ctx, http.MethodPost, joinURL(c.base, "/images/edits"), &buf)
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", mw.FormDataContentType())
	}
	httpReq.Header.Set("Authorization", "Bearer "+c.key)
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.http.Do(httpReq)
	if err != nil {
		return &Result{RequestLog: logBody}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return &Result{RequestLog: logBody}, readUpstreamError(resp)
	}

	var out struct {
		Created      int64  `json:"created"`
		Background   string `json:"background"`
		OutputFormat string `json:"output_format"`
		Quality      string `json:"quality"`
		Size         string `json:"size"`
		Usage        any    `json:"usage"`
		Data         []struct {
			B64JSON       string `json:"b64_json"`
			URL           string `json:"url"`
			RevisedPrompt string `json:"revised_prompt"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 512<<20)).Decode(&out); err != nil {
		return &Result{RequestLog: logBody}, fmt.Errorf("decode upstream response: %w", err)
	}
	res := &Result{RequestLog: logBody, Meta: map[string]any{}}
	var revised []string
	for _, d := range out.Data {
		var data []byte
		switch {
		case d.B64JSON != "":
			data, err = base64.StdEncoding.DecodeString(d.B64JSON)
			if err != nil {
				return res, fmt.Errorf("decode image: %w", err)
			}
		case d.URL != "":
			// Some OpenAI-compatible relays return URLs instead of base64.
			data, err = fetch(ctx, c.http, d.URL)
			if err != nil {
				return res, fmt.Errorf("download image: %w", err)
			}
		default:
			continue
		}
		res.Images = append(res.Images, OutputImage{Data: data, Mime: http.DetectContentType(data)})
		if d.RevisedPrompt != "" {
			revised = append(revised, d.RevisedPrompt)
		}
	}
	setIf := func(k string, v any) {
		switch x := v.(type) {
		case string:
			if x == "" {
				return
			}
		case nil:
			return
		}
		res.Meta[k] = v
	}
	setIf("usage", out.Usage)
	setIf("size", out.Size)
	setIf("quality", out.Quality)
	setIf("background", out.Background)
	setIf("output_format", out.OutputFormat)
	if len(revised) > 0 {
		res.Meta["revised_prompt"] = revised
	}
	if len(res.Images) == 0 {
		return res, fmt.Errorf("upstream returned no images")
	}
	return res, nil
}

func (c *openAI) Test(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, joinURL(c.base, "/models"), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.key)
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return readUpstreamError(resp)
	}
	return nil
}

// typed converts the numeric fields back to JSON numbers.
func typed(k, v string) any {
	if k == "n" || k == "output_compression" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return v
}

func extFor(mime string) string {
	switch mime {
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	}
	return ".png"
}

func escapeQuotes(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\r", "", "\n", "").Replace(s)
}

func fetch(ctx context.Context, c *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil, fmt.Errorf("status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 100<<20))
}
