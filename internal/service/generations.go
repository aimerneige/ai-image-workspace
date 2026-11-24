package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/provider"
	"github.com/aimerneige/ai-image-workspace/internal/storage"
)

var (
	ErrTooManyRunning = errors.New("too_many_running")
	ErrUnknownModel   = errors.New("unknown_model")
	ErrNotRunning     = errors.New("not_running")
)

type Generations struct {
	db        *gorm.DB
	store     *storage.Store
	providers *Providers
	audit     *Audit
	timeout   time.Duration
	maxPer    int

	mu      sync.Mutex
	running map[string]*job
	wg      sync.WaitGroup
	closing bool
}

type job struct {
	userID   uint
	cancel   context.CancelFunc
	canceled bool
}

func NewGenerations(db *gorm.DB, store *storage.Store, providers *Providers, audit *Audit, timeout time.Duration, maxPerUser int) *Generations {
	return &Generations{
		db: db, store: store, providers: providers, audit: audit,
		timeout: timeout, maxPer: maxPerUser, running: map[string]*job{},
	}
}

// RecoverInterrupted marks jobs left running by a previous process as failed.
func (g *Generations) RecoverInterrupted() {
	res := g.db.Model(&model.Generation{}).
		Where("status IN ?", []string{model.StatusQueued, model.StatusRunning}).
		Updates(map[string]any{"status": model.StatusFailed, "error": "interrupted: the server restarted before the job finished", "finished_at": time.Now()})
	if res.RowsAffected > 0 {
		slog.Warn("marked interrupted generations as failed", "count", res.RowsAffected)
	}
}

type CreateInput struct {
	Actor        Actor
	ProviderID   uint
	Model        string
	Prompt       string
	Params       provider.Params
	Uploads      [][]byte
	ReferenceIDs []string
}

func (g *Generations) Create(in CreateInput) (*model.Generation, error) {
	p, err := g.providers.Get(in.ProviderID)
	if err != nil {
		return nil, err
	}
	if !p.Enabled {
		return nil, ErrProviderDisabled
	}
	in.Model = strings.TrimSpace(in.Model)
	if models := DecodeModels(p.Models); in.Model == "" || (len(models) > 0 && !slices.Contains(models, in.Model)) {
		return nil, ErrUnknownModel
	}
	if strings.TrimSpace(in.Prompt) == "" {
		return nil, fmt.Errorf("%w: prompt is required", provider.ErrInvalid)
	}
	if in.Params.N == 0 {
		in.Params.N = 1
	}
	client, err := g.providers.Client(p)
	if err != nil {
		return nil, err
	}
	// Placeholder images let Validate check count limits without loading bytes.
	probe := provider.Request{Model: in.Model, Prompt: in.Prompt, Params: in.Params,
		Images: make([]provider.InputImage, len(in.Uploads)+len(in.ReferenceIDs))}
	if err := client.Validate(probe); err != nil {
		g.audit.Log(in.Actor, "generation.rejected", "", map[string]any{"provider": p.Name, "model": in.Model, "error": err.Error()})
		return nil, err
	}

	g.mu.Lock()
	if g.closing {
		g.mu.Unlock()
		return nil, errors.New("server is shutting down")
	}
	active := 0
	for _, j := range g.running {
		if j.userID == in.Actor.UserID {
			active++
		}
	}
	if active >= g.maxPer {
		g.mu.Unlock()
		return nil, ErrTooManyRunning
	}
	genID := uuid.NewString()
	ctx, cancel := context.WithTimeout(context.Background(), g.timeout)
	j := &job{userID: in.Actor.UserID, cancel: cancel}
	g.running[genID] = j
	g.mu.Unlock()

	release := func() {
		g.mu.Lock()
		delete(g.running, genID)
		g.mu.Unlock()
		cancel()
	}

	inputs, images, err := g.collectInputs(in, genID)
	if err != nil {
		release()
		return nil, err
	}

	params, _ := json.Marshal(in.Params)
	now := time.Now()
	mode := model.ModeGenerate
	if len(inputs) > 0 {
		mode = model.ModeEdit
	}
	gen := &model.Generation{
		ID: genID, UserID: in.Actor.UserID, ProviderID: p.ID, ProviderName: p.Name, ProviderType: p.Type,
		Model: in.Model, Mode: mode, Prompt: model.LongText(in.Prompt), Params: model.LongText(params),
		Status: model.StatusRunning, StartedAt: &now,
	}
	err = g.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(gen).Error; err != nil {
			return err
		}
		if len(images) > 0 {
			return tx.Create(&images).Error
		}
		return nil
	})
	if err != nil {
		release()
		return nil, err
	}
	gen.Images = images

	g.audit.Log(in.Actor, "generation.create", genID, map[string]any{
		"provider": p.Name, "model": in.Model, "mode": mode, "inputs": len(inputs), "n": in.Params.N,
	})

	g.wg.Add(1)
	go func() {
		defer g.wg.Done()
		defer release()
		g.run(ctx, j, gen, client, provider.Request{Model: in.Model, Prompt: in.Prompt, Images: inputs, Params: in.Params}, in.Actor)
	}()
	return gen, nil
}

// collectInputs stores uploads and resolves referenced images owned by the user.
func (g *Generations) collectInputs(in CreateInput, genID string) ([]provider.InputImage, []model.Image, error) {
	var inputs []provider.InputImage
	var rows []model.Image
	if len(in.ReferenceIDs) > 0 {
		var refs []model.Image
		if err := g.db.Where("id IN ? AND user_id = ?", in.ReferenceIDs, in.Actor.UserID).Find(&refs).Error; err != nil {
			return nil, nil, err
		}
		byID := map[string]model.Image{}
		for _, r := range refs {
			byID[r.ID] = r
		}
		for _, id := range in.ReferenceIDs {
			r, ok := byID[id]
			if !ok {
				return nil, nil, fmt.Errorf("%w: reference image %s not found", provider.ErrInvalid, id)
			}
			data, err := g.store.Read(r.Path)
			if err != nil {
				return nil, nil, fmt.Errorf("%w: reference image %s is missing on disk", provider.ErrInvalid, id)
			}
			inputs = append(inputs, provider.InputImage{Data: data, Mime: r.MimeType})
			// A new row shares the file with the original image.
			rows = append(rows, model.Image{
				ID: uuid.NewString(), UserID: in.Actor.UserID, GenerationID: genID, Role: model.ImageInput,
				Position: len(rows), Path: r.Path, ThumbPath: r.ThumbPath, MimeType: r.MimeType,
				Width: r.Width, Height: r.Height, Bytes: r.Bytes,
			})
		}
	}
	for _, data := range in.Uploads {
		saved, err := g.store.Save(data)
		if err != nil {
			return nil, nil, fmt.Errorf("%w: %v", provider.ErrInvalid, err)
		}
		inputs = append(inputs, provider.InputImage{Data: data, Mime: saved.MimeType})
		rows = append(rows, imageRow(saved, in.Actor.UserID, genID, model.ImageInput, len(rows)))
	}
	return inputs, rows, nil
}

func imageRow(s *storage.Saved, userID uint, genID, role string, pos int) model.Image {
	return model.Image{
		ID: s.ID, UserID: userID, GenerationID: genID, Role: role, Position: pos,
		Path: s.Path, ThumbPath: s.ThumbPath, MimeType: s.MimeType, Width: s.Width, Height: s.Height, Bytes: s.Bytes,
	}
}

func (g *Generations) run(ctx context.Context, j *job, gen *model.Generation, client provider.Client, req provider.Request, actor Actor) {
	start := time.Now()
	res, err := client.Generate(ctx, req)

	updates := map[string]any{"finished_at": time.Now(), "duration_ms": time.Since(start).Milliseconds()}
	meta := map[string]any{}
	if res != nil {
		if res.RequestLog != nil {
			if b, e := json.Marshal(res.RequestLog); e == nil {
				updates["request_log"] = model.LongText(b)
			}
		}
		for k, v := range res.Meta {
			meta[k] = v
		}
		if res.Text != "" {
			meta["text"] = res.Text
		}
	}

	var outputs []model.Image
	if err == nil {
		for i, img := range res.Images {
			saved, serr := g.store.Save(img.Data)
			if serr != nil {
				slog.Error("save output image", "generation", gen.ID, "err", serr)
				meta["save_error"] = serr.Error()
				continue
			}
			outputs = append(outputs, imageRow(saved, gen.UserID, gen.ID, model.ImageOutput, i))
		}
		if len(outputs) == 0 {
			err = errors.New("could not store any returned image")
		}
	}

	g.mu.Lock()
	userCanceled := j.canceled
	g.mu.Unlock()

	status := model.StatusSucceeded
	switch {
	case err == nil:
	case userCanceled:
		status = model.StatusCanceled
		updates["error"] = model.LongText("canceled by user")
	case errors.Is(ctx.Err(), context.DeadlineExceeded):
		status = model.StatusFailed
		updates["error"] = model.LongText(fmt.Sprintf("timed out after %s", g.timeout))
	default:
		status = model.StatusFailed
		updates["error"] = model.LongText(err.Error())
	}
	var perr *provider.Error
	if errors.As(err, &perr) {
		meta["upstream_status"] = perr.Status
		if perr.Body != "" {
			meta["upstream_body"] = truncateStr(perr.Body, 8000)
		}
	}
	updates["status"] = status
	if len(meta) > 0 {
		if b, e := json.Marshal(meta); e == nil {
			updates["response_meta"] = model.LongText(b)
		}
	}

	errDeleted := errors.New("generation deleted while running")
	dbErr := g.db.Transaction(func(tx *gorm.DB) error {
		res := tx.Model(&model.Generation{}).Where("id = ?", gen.ID).Updates(updates)
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			return errDeleted
		}
		if len(outputs) > 0 {
			return tx.Create(&outputs).Error
		}
		return nil
	})
	if dbErr != nil {
		for _, o := range outputs {
			g.store.Remove(o.Path, o.ThumbPath)
		}
	}
	if errors.Is(dbErr, errDeleted) {
		return
	}
	if dbErr != nil {
		slog.Error("persist generation result", "generation", gen.ID, "err", dbErr)
	}
	detail := map[string]any{"status": status, "duration_ms": updates["duration_ms"], "images": len(outputs)}
	if e, ok := updates["error"]; ok {
		detail["error"] = truncateStr(string(e.(model.LongText)), 500)
	}
	g.audit.Log(actor, "generation.finish", gen.ID, detail)
}

// Cancel aborts a running generation owned by userID (admins may pass 0).
func (g *Generations) Cancel(id string, userID uint) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	j, ok := g.running[id]
	if !ok || (userID != 0 && j.userID != userID) {
		return ErrNotRunning
	}
	j.canceled = true
	j.cancel()
	return nil
}

// Shutdown cancels running jobs and waits for them to persist their state.
func (g *Generations) Shutdown(ctx context.Context) {
	g.mu.Lock()
	g.closing = true
	for _, j := range g.running {
		j.cancel()
	}
	g.mu.Unlock()
	done := make(chan struct{})
	go func() { g.wg.Wait(); close(done) }()
	select {
	case <-done:
	case <-ctx.Done():
	}
}

type GenFilter struct {
	UserID       uint
	Query        string
	Status       string
	ProviderType string
	Model        string
	Mode         string
	Favorite     bool
	Page         int
	PageSize     int
}

func (g *Generations) List(f GenFilter) ([]model.Generation, int64, error) {
	q := g.db.Model(&model.Generation{}).Where("user_id = ?", f.UserID)
	if f.Query != "" {
		like := "%" + strings.ToLower(f.Query) + "%"
		q = q.Where("LOWER(prompt) LIKE ? OR LOWER(model) LIKE ?", like, like)
	}
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.ProviderType != "" {
		q = q.Where("provider_type = ?", f.ProviderType)
	}
	if f.Model != "" {
		q = q.Where("model = ?", f.Model)
	}
	if f.Mode != "" {
		q = q.Where("mode = ?", f.Mode)
	}
	if f.Favorite {
		q = q.Where("favorite = ?", true)
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.Generation
	err := q.Preload("Images", func(db *gorm.DB) *gorm.DB { return db.Order("role ASC, position ASC") }).
		Order("created_at DESC").Offset((f.Page - 1) * f.PageSize).Limit(f.PageSize).Find(&rows).Error
	return rows, total, err
}

func (g *Generations) Get(id string, userID uint) (*model.Generation, error) {
	var gen model.Generation
	err := g.db.Preload("Images", func(db *gorm.DB) *gorm.DB { return db.Order("role ASC, position ASC") }).
		Where("id = ? AND user_id = ?", id, userID).First(&gen).Error
	if err != nil {
		return nil, ErrNotFound
	}
	return &gen, nil
}

func (g *Generations) SetFavorite(id string, userID uint, fav bool) error {
	res := g.db.Model(&model.Generation{}).Where("id = ? AND user_id = ?", id, userID).Update("favorite", fav)
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return res.Error
}

// Delete soft-deletes the record and removes image files no longer referenced.
func (g *Generations) Delete(id string, userID uint) error {
	gen, err := g.Get(id, userID)
	if err != nil {
		return err
	}
	_ = g.Cancel(id, userID)
	var orphanPaths []string
	err = g.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("generation_id = ?", id).Delete(&model.Image{}).Error; err != nil {
			return err
		}
		for _, img := range gen.Images {
			var n int64
			tx.Model(&model.Image{}).Where("path = ?", img.Path).Count(&n)
			if n == 0 {
				orphanPaths = append(orphanPaths, img.Path, img.ThumbPath)
			}
		}
		return tx.Delete(gen).Error
	})
	if err != nil {
		return err
	}
	g.store.Remove(orphanPaths...)
	return nil
}

func (g *Generations) Image(id string) (*model.Image, error) {
	var img model.Image
	if err := g.db.Where("id = ?", id).First(&img).Error; err != nil {
		return nil, ErrNotFound
	}
	return &img, nil
}

type Stats struct {
	Total     int64 `json:"total"`
	Succeeded int64 `json:"succeeded"`
	Failed    int64 `json:"failed"`
	Images    int64 `json:"images"`
	Favorites int64 `json:"favorites"`
}

func (g *Generations) Stats(userID uint) Stats {
	var s Stats
	base := func() *gorm.DB { return g.db.Model(&model.Generation{}).Where("user_id = ?", userID) }
	base().Count(&s.Total)
	base().Where("status = ?", model.StatusSucceeded).Count(&s.Succeeded)
	base().Where("status = ?", model.StatusFailed).Count(&s.Failed)
	base().Where("favorite = ?", true).Count(&s.Favorites)
	g.db.Model(&model.Image{}).Where("user_id = ? AND role = ?", userID, model.ImageOutput).Count(&s.Images)
	return s
}
