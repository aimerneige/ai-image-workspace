package api

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aimerneige/ai-image-workspace/internal/config"
	"github.com/aimerneige/ai-image-workspace/internal/database"
	"github.com/aimerneige/ai-image-workspace/internal/provider"
	"github.com/aimerneige/ai-image-workspace/internal/secret"
	"github.com/aimerneige/ai-image-workspace/internal/service"
	"github.com/aimerneige/ai-image-workspace/internal/storage"
)

// fakeClient stands in for an upstream provider.
type fakeClient struct {
	delay time.Duration
	last  *provider.Request
}

func (f *fakeClient) Validate(req provider.Request) error {
	if req.Params.N > 4 {
		return provider.ErrInvalid
	}
	return nil
}

func (f *fakeClient) Test(context.Context, string) error { return nil }

func (f *fakeClient) Generate(ctx context.Context, req provider.Request) (*provider.Result, error) {
	f.last = &req
	select {
	case <-time.After(f.delay):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if strings.Contains(req.Prompt, "fail") {
		return &provider.Result{RequestLog: map[string]any{"prompt": req.Prompt}}, &provider.Error{Status: 400, Message: "blocked"}
	}
	var out []provider.OutputImage
	for i := 0; i < req.Params.N; i++ {
		out = append(out, provider.OutputImage{Data: pngBytes(64, 48), Mime: "image/png"})
	}
	return &provider.Result{Images: out, Text: "ok", Meta: map[string]any{"usage": 1}, RequestLog: map[string]any{"prompt": req.Prompt}}, nil
}

func pngBytes(w, h int) []byte {
	var buf bytes.Buffer
	_ = png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, w, h)))
	return buf.Bytes()
}

type env struct {
	srv  *httptest.Server
	fake *fakeClient
	gens *service.Generations
}

func newEnv(t *testing.T, allowRegistration bool) *env {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.Database.DSN = filepath.Join(dir, "test.db")
	cfg.Database.LogLevel = "silent"
	cfg.Storage.Dir = dir
	cfg.Auth.AllowRegistration = allowRegistration
	cfg.Generate.Timeout = 5 * time.Second
	db, err := database.Open(cfg.Database)
	if err != nil {
		t.Fatal(err)
	}
	box, _ := secret.New("test-secret")
	store, _ := storage.New(dir)
	audit := service.NewAudit(db)
	users := service.NewUsers(db, time.Hour)
	providers := service.NewProviders(db, box)
	fake := &fakeClient{delay: 50 * time.Millisecond}
	providers.NewClient = func(provider.Options) (provider.Client, error) { return fake, nil }
	gens := service.NewGenerations(db, store, providers, audit, cfg.Generate.Timeout, 3)
	if !allowRegistration {
		if err := users.SeedAdmin("root", "rootpassword"); err != nil {
			t.Fatal(err)
		}
	}
	s := New(Deps{Config: cfg, Users: users, Providers: providers, Generations: gens, Audit: audit, Store: store})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return &env{srv: ts, fake: fake, gens: gens}
}

type client struct {
	t    *testing.T
	base string
	http *http.Client
}

func (e *env) client(t *testing.T) *client {
	jar, _ := cookiejar.New(nil)
	return &client{t: t, base: e.srv.URL, http: &http.Client{Jar: jar}}
}

func (c *client) do(method, path string, body any, out any) int {
	c.t.Helper()
	var rd io.Reader
	ct := ""
	switch b := body.(type) {
	case nil:
	case *multipartBody:
		rd, ct = &b.buf, b.ct
	default:
		data, _ := json.Marshal(b)
		rd, ct = bytes.NewReader(data), "application/json"
	}
	req, _ := http.NewRequest(method, c.base+path, rd)
	if ct != "" {
		req.Header.Set("Content-Type", ct)
	}
	req.Header.Set("X-Requested-With", "test")
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

type multipartBody struct {
	buf bytes.Buffer
	ct  string
}

func multipartGen(payload any, files ...[]byte) *multipartBody {
	mb := &multipartBody{}
	w := multipart.NewWriter(&mb.buf)
	p, _ := json.Marshal(payload)
	_ = w.WriteField("payload", string(p))
	for i, f := range files {
		fw, _ := w.CreateFormFile("images", "ref"+string(rune('a'+i))+".png")
		_, _ = fw.Write(f)
	}
	_ = w.Close()
	mb.ct = w.FormDataContentType()
	return mb
}

type errBody struct {
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func TestAuthFlowAndRoles(t *testing.T) {
	e := newEnv(t, true)
	admin := e.client(t)

	var reg struct{ User userDTO }
	if st := admin.do("POST", "/api/auth/register", map[string]string{"username": "alice", "password": "password1"}, &reg); st != 200 {
		t.Fatalf("register status %d", st)
	}
	if reg.User.Role != "admin" {
		t.Fatalf("first user should be admin, got %q", reg.User.Role)
	}
	var eb errBody
	if st := e.client(t).do("POST", "/api/auth/register", map[string]string{"username": "ALICE", "password": "password1"}, &eb); st != 409 || eb.Error.Code != "username_taken" {
		t.Fatalf("duplicate (case-insensitive) username: %d %s", st, eb.Error.Code)
	}
	if st := e.client(t).do("POST", "/api/auth/register", map[string]string{"username": "bob", "password": "short"}, &eb); st != 400 || eb.Error.Code != "weak_password" {
		t.Fatalf("weak password: %d %s", st, eb.Error.Code)
	}

	bob := e.client(t)
	bob.do("POST", "/api/auth/register", map[string]string{"username": "bob", "password": "password2"}, &reg)
	if reg.User.Role != "user" {
		t.Fatalf("second user should be user, got %q", reg.User.Role)
	}
	if st := bob.do("GET", "/api/admin/providers", nil, nil); st != 403 {
		t.Fatalf("non-admin admin access: %d", st)
	}
	if st := admin.do("GET", "/api/admin/providers", nil, nil); st != 200 {
		t.Fatalf("admin access: %d", st)
	}

	// Logout invalidates the session.
	admin.do("POST", "/api/auth/logout", nil, nil)
	if st := admin.do("GET", "/api/auth/me", nil, nil); st != 401 {
		t.Fatalf("after logout: %d", st)
	}
	if st := admin.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "nope-nope"}, &eb); st != 401 || eb.Error.Code != "invalid_credentials" {
		t.Fatalf("bad login: %d %s", st, eb.Error.Code)
	}
	if st := admin.do("POST", "/api/auth/login", map[string]string{"username": "Alice", "password": "password1"}, nil); st != 200 {
		t.Fatalf("login: %d", st)
	}
}

func TestRegistrationDisabledAndCSRF(t *testing.T) {
	e := newEnv(t, false)
	c := e.client(t)
	var meta map[string]any
	c.do("GET", "/api/meta", nil, &meta)
	if meta["allow_registration"] != false {
		t.Fatalf("meta: %#v", meta)
	}
	var eb errBody
	if st := c.do("POST", "/api/auth/register", map[string]string{"username": "eve", "password": "password1"}, &eb); st != 403 || eb.Error.Code != "registration_disabled" {
		t.Fatalf("register when disabled: %d %s", st, eb.Error.Code)
	}
	// The seeded admin can sign in.
	if st := c.do("POST", "/api/auth/login", map[string]string{"username": "root", "password": "rootpassword"}, nil); st != 200 {
		t.Fatalf("seeded admin login: %d", st)
	}
	// Missing CSRF header is rejected.
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/auth/logout", nil)
	resp, _ := c.http.Do(req)
	if resp.StatusCode != 403 {
		t.Fatalf("csrf: %d", resp.StatusCode)
	}
	resp.Body.Close()
}

func TestGenerationLifecycle(t *testing.T) {
	e := newEnv(t, true)
	alice := e.client(t)
	alice.do("POST", "/api/auth/register", map[string]string{"username": "alice", "password": "password1"}, nil)

	var p adminProviderDTO
	if st := alice.do("POST", "/api/admin/providers", map[string]any{"name": "OpenAI", "type": "openai", "api_key": "sk-secret-value-1234"}, &p); st != 201 {
		t.Fatalf("create provider: %d", st)
	}
	if p.APIKey == "" || strings.Contains(p.APIKey, "secret-value") {
		t.Fatalf("API key must be masked, got %q", p.APIKey)
	}
	if len(p.Models) == 0 || p.Models[0] != "gpt-image-2" {
		t.Fatalf("default models not applied: %v", p.Models)
	}

	// Unknown model and invalid params are rejected synchronously.
	var eb errBody
	if st := alice.do("POST", "/api/generations", map[string]any{"provider_id": p.ID, "model": "dall-e-9", "prompt": "x"}, &eb); st != 400 || eb.Error.Code != "unknown_model" {
		t.Fatalf("unknown model: %d %s", st, eb.Error.Code)
	}
	if st := alice.do("POST", "/api/generations", map[string]any{"provider_id": p.ID, "model": "gpt-image-2", "prompt": "x", "params": map[string]any{"n": 9}}, &eb); st != 400 || eb.Error.Code != "invalid_request" {
		t.Fatalf("invalid params: %d %s", st, eb.Error.Code)
	}

	// Multipart generation with an uploaded reference image.
	var gen generationDTO
	payload := map[string]any{"provider_id": p.ID, "model": "gpt-image-2", "prompt": "a cat", "params": map[string]any{"n": 2}}
	if st := alice.do("POST", "/api/generations", multipartGen(payload, pngBytes(8, 8)), &gen); st != 202 {
		t.Fatalf("create generation: %d", st)
	}
	if gen.Status != "running" || gen.Mode != "edit" || len(gen.Inputs) != 1 {
		t.Fatalf("unexpected initial state: %+v", gen)
	}
	gen = waitDone(t, alice, gen.ID)
	if gen.Status != "succeeded" || len(gen.Outputs) != 2 || gen.Text != "ok" {
		t.Fatalf("unexpected final state: %+v", gen)
	}
	if gen.Outputs[0].Width != 64 || gen.Outputs[0].Height != 48 {
		t.Fatalf("image dimensions not recorded: %+v", gen.Outputs[0])
	}
	if len(gen.RequestLog) == 0 || len(gen.ResponseMeta) == 0 {
		t.Fatal("request log / response meta missing")
	}

	// Images are served to the owner (original + thumbnail) but not to others.
	out := gen.Outputs[0]
	for _, u := range []string{out.URL, out.ThumbURL, out.URL + "?download=1"} {
		if st := alice.do("GET", strings.TrimPrefix(u, ""), nil, nil); st != 200 {
			t.Fatalf("owner image fetch %s: %d", u, st)
		}
	}
	bob := e.client(t)
	bob.do("POST", "/api/auth/register", map[string]string{"username": "bob", "password": "password2"}, nil)
	if st := bob.do("GET", out.URL, nil, nil); st != 404 {
		t.Fatalf("other user image fetch: %d", st)
	}
	if st := bob.do("GET", "/api/generations/"+gen.ID, nil, nil); st != 404 {
		t.Fatalf("other user generation fetch: %d", st)
	}
	// Bob cannot use Alice's image as a reference.
	if st := bob.do("POST", "/api/generations", map[string]any{"provider_id": p.ID, "model": "gpt-image-2", "prompt": "x", "reference_image_ids": []string{out.ID}}, &eb); st != 400 {
		t.Fatalf("foreign reference: %d", st)
	}

	// Reusing an output as a reference sends its bytes upstream.
	var gen2 generationDTO
	alice.do("POST", "/api/generations", map[string]any{"provider_id": p.ID, "model": "gpt-image-2", "prompt": "variation", "reference_image_ids": []string{out.ID}}, &gen2)
	gen2 = waitDone(t, alice, gen2.ID)
	if gen2.Status != "succeeded" || len(gen2.Inputs) != 1 || len(e.fake.last.Images) != 1 {
		t.Fatalf("reference reuse failed: %+v", gen2)
	}

	// Upstream failures are recorded with their error.
	var gen3 generationDTO
	alice.do("POST", "/api/generations", map[string]any{"provider_id": p.ID, "model": "gpt-image-2", "prompt": "please fail"}, &gen3)
	gen3 = waitDone(t, alice, gen3.ID)
	if gen3.Status != "failed" || !strings.Contains(gen3.Error, "blocked") {
		t.Fatalf("failure not recorded: %+v", gen3)
	}

	// Cancel a slow job.
	e.fake.delay = 3 * time.Second
	var gen4 generationDTO
	alice.do("POST", "/api/generations", map[string]any{"provider_id": p.ID, "model": "gpt-image-2", "prompt": "slow"}, &gen4)
	if st := alice.do("POST", "/api/generations/"+gen4.ID+"/cancel", nil, nil); st != 204 {
		t.Fatalf("cancel: %d", st)
	}
	gen4 = waitDone(t, alice, gen4.ID)
	if gen4.Status != "canceled" {
		t.Fatalf("expected canceled, got %s", gen4.Status)
	}
	e.fake.delay = 10 * time.Millisecond

	// History listing, filtering, favorites, delete.
	var pg page[generationDTO]
	alice.do("GET", "/api/generations?page_size=10", nil, &pg)
	if pg.Total != 4 {
		t.Fatalf("expected 4 generations, got %d", pg.Total)
	}
	alice.do("GET", "/api/generations?status=failed", nil, &pg)
	if pg.Total != 1 {
		t.Fatalf("status filter: %d", pg.Total)
	}
	alice.do("GET", "/api/generations?q=VARIATION", nil, &pg)
	if pg.Total != 1 {
		t.Fatalf("search filter: %d", pg.Total)
	}
	if st := alice.do("PATCH", "/api/generations/"+gen.ID, map[string]any{"favorite": true}, nil); st != 204 {
		t.Fatalf("favorite: %d", st)
	}
	alice.do("GET", "/api/generations?favorite=true", nil, &pg)
	if pg.Total != 1 {
		t.Fatalf("favorite filter: %d", pg.Total)
	}
	if st := alice.do("DELETE", "/api/generations/"+gen.ID, nil, nil); st != 204 {
		t.Fatalf("delete: %d", st)
	}
	// The shared file is still referenced by gen2's input row, so it must survive.
	if st := alice.do("GET", gen2.Inputs[0].URL, nil, nil); st != 200 {
		t.Fatalf("shared reference image removed: %d", st)
	}

	// Everything is audited.
	var audit page[auditDTO]
	alice.do("GET", "/api/admin/audit-logs?page_size=200", nil, &audit)
	actions := map[string]int{}
	for _, a := range audit.Items {
		actions[a.Action]++
	}
	for _, want := range []string{"auth.register", "provider.create", "generation.create", "generation.finish", "generation.rejected", "generation.cancel", "generation.delete", "generation.favorite"} {
		if actions[want] == 0 {
			t.Errorf("missing audit action %s (have %v)", want, actions)
		}
	}
}

func TestLastAdminProtection(t *testing.T) {
	e := newEnv(t, true)
	admin := e.client(t)
	var reg struct{ User userDTO }
	admin.do("POST", "/api/auth/register", map[string]string{"username": "alice", "password": "password1"}, &reg)
	var eb errBody
	path := "/api/admin/users/" + itoa(reg.User.ID)
	if st := admin.do("PATCH", path, map[string]any{"role": "user"}, &eb); st != 409 || eb.Error.Code != "last_admin" {
		t.Fatalf("demoting last admin: %d %s", st, eb.Error.Code)
	}
	if st := admin.do("DELETE", path, nil, &eb); st != 400 || eb.Error.Code != "cannot_delete_self" {
		t.Fatalf("self delete: %d %s", st, eb.Error.Code)
	}
}

func itoa(n uint) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func waitDone(t *testing.T, c *client, id string) generationDTO {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var g generationDTO
		c.do("GET", "/api/generations/"+id, nil, &g)
		if g.Status != "running" && g.Status != "queued" {
			return g
		}
		time.Sleep(30 * time.Millisecond)
	}
	t.Fatalf("generation %s did not finish", id)
	return generationDTO{}
}
