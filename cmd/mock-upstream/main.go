// Command mock-upstream imitates the OpenAI Images API and the Gemini
// generateContent API so the workspace can be developed and demoed without
// real API keys. Images are procedurally generated gradients.
//
//	go run ./cmd/mock-upstream -addr :9090 -delay 3s
//
// Then add providers with base URL http://localhost:9090/v1 (OpenAI) and
// http://localhost:9090 (Gemini). A prompt containing "fail" returns an error.
package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"
)

var delay time.Duration

func main() {
	addr := flag.String("addr", ":9090", "listen address")
	flag.DurationVar(&delay, "delay", 3*time.Second, "artificial latency per request")
	flag.Parse()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"data": []any{map[string]any{"id": "gpt-image-2"}}})
	})
	mux.HandleFunc("POST /v1/images/generations", openaiHandler)
	mux.HandleFunc("POST /v1/images/edits", openaiHandler)
	mux.HandleFunc("GET /v1beta/models", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"models": []any{map[string]any{"name": "models/gemini-3-pro-image"}}})
	})
	mux.HandleFunc("POST /v1beta/models/{rest}", geminiHandler)
	log.Printf("mock upstream listening on %s (delay %s)", *addr, delay)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func openaiHandler(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ") {
		writeJSON(w, 401, map[string]any{"error": map[string]any{"message": "missing API key"}})
		return
	}
	var prompt, size string
	n := 1
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		_ = r.ParseMultipartForm(64 << 20)
		prompt, size = r.FormValue("prompt"), r.FormValue("size")
		n, _ = strconv.Atoi(r.FormValue("n"))
	} else {
		var body struct {
			Prompt string `json:"prompt"`
			Size   string `json:"size"`
			N      int    `json:"n"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		prompt, size, n = body.Prompt, body.Size, body.N
	}
	time.Sleep(delay)
	if strings.Contains(strings.ToLower(prompt), "fail") {
		writeJSON(w, 400, map[string]any{"error": map[string]any{"message": "Your request was rejected by the safety system (mock).", "code": "moderation_blocked"}})
		return
	}
	n = max(1, min(n, 10))
	wd, ht := 1024, 1024
	if m := strings.Split(size, "x"); len(m) == 2 {
		if a, err := strconv.Atoi(m[0]); err == nil {
			wd = a
		}
		if b, err := strconv.Atoi(m[1]); err == nil {
			ht = b
		}
	}
	var data []any
	for i := 0; i < n; i++ {
		data = append(data, map[string]any{"b64_json": base64.StdEncoding.EncodeToString(render(prompt, i, wd, ht))})
	}
	writeJSON(w, 200, map[string]any{
		"created": time.Now().Unix(), "data": data, "size": fmt.Sprintf("%dx%d", wd, ht), "quality": "medium",
		"background": "opaque", "output_format": "png",
		"usage": map[string]any{"input_tokens": len(prompt) / 4, "output_tokens": 1056 * n, "total_tokens": len(prompt)/4 + 1056*n},
	})
}

func geminiHandler(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("x-goog-api-key") == "" {
		writeJSON(w, 403, map[string]any{"error": map[string]any{"code": 403, "message": "API key not valid (mock)", "status": "PERMISSION_DENIED"}})
		return
	}
	var body struct {
		Contents []struct {
			Parts []struct {
				Text string `json:"text"`
			} `json:"parts"`
		} `json:"contents"`
		GenerationConfig struct {
			ImageConfig struct {
				AspectRatio string `json:"aspectRatio"`
				ImageSize   string `json:"imageSize"`
			} `json:"imageConfig"`
		} `json:"generationConfig"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	prompt := ""
	if len(body.Contents) > 0 && len(body.Contents[0].Parts) > 0 {
		prompt = body.Contents[0].Parts[0].Text
	}
	time.Sleep(delay)
	if strings.Contains(strings.ToLower(prompt), "fail") {
		writeJSON(w, 200, map[string]any{"promptFeedback": map[string]any{"blockReason": "SAFETY"}})
		return
	}
	base := 1024
	switch body.GenerationConfig.ImageConfig.ImageSize {
	case "2K":
		base = 2048
	case "4K":
		base = 4096
	}
	wd, ht := base, base
	if parts := strings.Split(body.GenerationConfig.ImageConfig.AspectRatio, ":"); len(parts) == 2 {
		a, _ := strconv.ParseFloat(parts[0], 64)
		b, _ := strconv.ParseFloat(parts[1], 64)
		if a > 0 && b > 0 {
			if a >= b {
				ht = int(float64(base) * b / a)
			} else {
				wd = int(float64(base) * a / b)
			}
		}
	}
	// Keep mock images small enough to be quick.
	if wd > 2048 || ht > 2048 {
		wd, ht = wd/2, ht/2
	}
	img := render(prompt, int(time.Now().UnixNano()%7), wd, ht)
	writeJSON(w, 200, map[string]any{
		"candidates": []any{map[string]any{
			"content": map[string]any{"role": "model", "parts": []any{
				map[string]any{"text": "Here is your image (mock)."},
				map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(img)}},
			}},
			"finishReason": "STOP",
		}},
		"usageMetadata": map[string]any{"promptTokenCount": len(prompt) / 4, "candidatesTokenCount": 1290, "totalTokenCount": len(prompt)/4 + 1290},
		"modelVersion":  strings.TrimSuffix(r.PathValue("rest"), ":generateContent"),
	})
}

// render draws a smooth multi-stop gradient with soft circles seeded by the prompt.
func render(prompt string, salt, w, h int) []byte {
	if w <= 0 || h <= 0 || w*h > 16_000_000 {
		w, h = 1024, 1024
	}
	hs := fnv.New32a()
	_, _ = hs.Write([]byte(prompt))
	seed := float64(hs.Sum32()%360) + float64(salt)*47
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	c1, c2, c3 := hsl(seed, 0.75, 0.55), hsl(seed+70, 0.7, 0.5), hsl(seed+150, 0.65, 0.35)
	cx, cy := float64(w)*0.68, float64(h)*0.32
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			t := (float64(x)/float64(w) + float64(y)/float64(h)) / 2
			col := mix(mix(c1, c2, t*1.6), c3, math.Max(0, t*1.6-0.6))
			d := math.Hypot(float64(x)-cx, float64(y)-cy) / (float64(min(w, h)) * 0.28)
			glow := math.Max(0, 1-d)
			col = mix(col, color.RGBA{255, 255, 255, 255}, glow*glow*0.55)
			img.Set(x, y, col)
		}
	}
	var buf bytes.Buffer
	_ = (&png.Encoder{CompressionLevel: png.BestSpeed}).Encode(&buf, img)
	return buf.Bytes()
}

func mix(a, b color.RGBA, t float64) color.RGBA {
	t = math.Max(0, math.Min(1, t))
	l := func(x, y uint8) uint8 { return uint8(float64(x)*(1-t) + float64(y)*t) }
	return color.RGBA{l(a.R, b.R), l(a.G, b.G), l(a.B, b.B), 255}
}

func hsl(h, s, l float64) color.RGBA {
	h = math.Mod(h, 360) / 360
	f := func(n float64) uint8 {
		k := math.Mod(n+h*12, 12)
		a := s * math.Min(l, 1-l)
		return uint8(255 * (l - a*math.Max(-1, math.Min(k-3, math.Min(9-k, 1)))))
	}
	return color.RGBA{f(0), f(8), f(4), 255}
}
