package api

import (
	"encoding/json"
	"time"

	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/service"
)

type userDTO struct {
	ID          uint       `json:"id"`
	Username    string     `json:"username"`
	Role        string     `json:"role"`
	Disabled    bool       `json:"disabled"`
	LastLoginAt *time.Time `json:"last_login_at"`
	CreatedAt   time.Time  `json:"created_at"`
	Generations *int64     `json:"generations,omitempty"`
}

func toUser(u *model.User) userDTO {
	return userDTO{ID: u.ID, Username: u.Username, Role: u.Role, Disabled: u.Disabled, LastLoginAt: u.LastLoginAt, CreatedAt: u.CreatedAt}
}

type imageDTO struct {
	ID       string `json:"id"`
	Role     string `json:"role"`
	URL      string `json:"url"`
	ThumbURL string `json:"thumb_url"`
	Mime     string `json:"mime"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Bytes    int64  `json:"bytes"`
}

func toImage(i model.Image) imageDTO {
	d := imageDTO{
		ID: i.ID, Role: i.Role, URL: "/api/images/" + i.ID, ThumbURL: "/api/images/" + i.ID,
		Mime: i.MimeType, Width: i.Width, Height: i.Height, Bytes: i.Bytes,
	}
	if i.ThumbPath != "" {
		d.ThumbURL += "?variant=thumb"
	}
	return d
}

type generationDTO struct {
	ID           string          `json:"id"`
	ProviderID   uint            `json:"provider_id"`
	ProviderName string          `json:"provider_name"`
	ProviderType string          `json:"provider_type"`
	Model        string          `json:"model"`
	Mode         string          `json:"mode"`
	Prompt       string          `json:"prompt"`
	Params       json.RawMessage `json:"params"`
	Status       string          `json:"status"`
	Error        string          `json:"error,omitempty"`
	Text         string          `json:"text,omitempty"`
	DurationMs   int64           `json:"duration_ms"`
	Favorite     bool            `json:"favorite"`
	CreatedAt    time.Time       `json:"created_at"`
	StartedAt    *time.Time      `json:"started_at"`
	FinishedAt   *time.Time      `json:"finished_at"`
	Inputs       []imageDTO      `json:"inputs"`
	Outputs      []imageDTO      `json:"outputs"`
	RequestLog   json.RawMessage `json:"request_log,omitempty"`
	ResponseMeta json.RawMessage `json:"response_meta,omitempty"`
}

func rawJSON(s model.LongText) json.RawMessage {
	if s == "" || !json.Valid([]byte(s)) {
		return nil
	}
	return json.RawMessage(s)
}

func toGeneration(g *model.Generation, detail bool) generationDTO {
	d := generationDTO{
		ID: g.ID, ProviderID: g.ProviderID, ProviderName: g.ProviderName, ProviderType: g.ProviderType,
		Model: g.Model, Mode: g.Mode, Prompt: string(g.Prompt), Params: rawJSON(g.Params), Status: g.Status,
		Error: string(g.Error), DurationMs: g.DurationMs, Favorite: g.Favorite, CreatedAt: g.CreatedAt,
		StartedAt: g.StartedAt, FinishedAt: g.FinishedAt, Inputs: []imageDTO{}, Outputs: []imageDTO{},
	}
	if d.Params == nil {
		d.Params = json.RawMessage("{}")
	}
	for _, img := range g.Images {
		if img.Role == model.ImageInput {
			d.Inputs = append(d.Inputs, toImage(img))
		} else {
			d.Outputs = append(d.Outputs, toImage(img))
		}
	}
	if meta := rawJSON(g.ResponseMeta); meta != nil {
		var m struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(meta, &m) == nil {
			d.Text = m.Text
		}
		if detail {
			d.ResponseMeta = meta
		}
	}
	if detail {
		d.RequestLog = rawJSON(g.RequestLog)
	}
	return d
}

type providerDTO struct {
	ID     uint     `json:"id"`
	Name   string   `json:"name"`
	Type   string   `json:"type"`
	Models []string `json:"models"`
}

type adminProviderDTO struct {
	providerDTO
	BaseURL   string    `json:"base_url"`
	APIKey    string    `json:"api_key_masked"`
	HasKey    bool      `json:"has_key"`
	Enabled   bool      `json:"enabled"`
	Source    string    `json:"source"`
	ConfigKey string    `json:"config_key,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toProvider(p *model.Provider) providerDTO {
	models := service.DecodeModels(p.Models)
	if models == nil {
		models = []string{}
	}
	return providerDTO{ID: p.ID, Name: p.Name, Type: p.Type, Models: models}
}

type auditDTO struct {
	ID        uint            `json:"id"`
	UserID    *uint           `json:"user_id"`
	Username  string          `json:"username"`
	Action    string          `json:"action"`
	Target    string          `json:"target"`
	Detail    json.RawMessage `json:"detail,omitempty"`
	IP        string          `json:"ip"`
	UserAgent string          `json:"user_agent"`
	CreatedAt time.Time       `json:"created_at"`
}

func toAudit(a model.AuditLog) auditDTO {
	return auditDTO{
		ID: a.ID, UserID: a.UserID, Username: a.Username, Action: a.Action, Target: a.Target,
		Detail: rawJSON(a.Detail), IP: a.IP, UserAgent: a.UserAgent, CreatedAt: a.CreatedAt,
	}
}

type page[T any] struct {
	Items    []T   `json:"items"`
	Total    int64 `json:"total"`
	Page     int   `json:"page"`
	PageSize int   `json:"page_size"`
}
