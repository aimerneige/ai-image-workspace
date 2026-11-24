package service

import (
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"gorm.io/gorm"

	"github.com/aimerneige/ai-image-workspace/internal/config"
	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/provider"
	"github.com/aimerneige/ai-image-workspace/internal/secret"
)

var (
	ErrReadOnlyProvider = errors.New("provider_read_only")
	ErrProviderDisabled = errors.New("provider_disabled")
	ErrInvalidProvider  = errors.New("invalid_provider")
)

// DefaultModels are offered when a provider is created without a model list.
// ChatGPT Image (gpt-image) and Nano Banana Pro come first.
var DefaultModels = map[string][]string{
	model.ProviderOpenAI: {"gpt-image-2", "chatgpt-image-latest", "gpt-image-1.5", "gpt-image-1-mini"},
	model.ProviderGemini: {"gemini-3-pro-image", "gemini-3-pro-image-preview", "gemini-3.1-flash-image", "gemini-2.5-flash-image"},
}

type Providers struct {
	db  *gorm.DB
	box *secret.Box
	// NewClient is swappable in tests.
	NewClient func(provider.Options) (provider.Client, error)
}

func NewProviders(db *gorm.DB, box *secret.Box) *Providers {
	return &Providers{db: db, box: box, NewClient: provider.New}
}

func DecodeModels(raw model.LongText) []string {
	var out []string
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func encodeModels(models []string, typ string) model.LongText {
	seen := map[string]bool{}
	var clean []string
	for _, m := range models {
		m = strings.TrimSpace(m)
		if m != "" && !seen[m] {
			seen[m] = true
			clean = append(clean, m)
		}
	}
	if len(clean) == 0 {
		clean = DefaultModels[typ]
	}
	b, _ := json.Marshal(clean)
	return model.LongText(b)
}

// SyncConfig upserts providers declared in the config file and removes those
// that were deleted from it.
func (s *Providers) SyncConfig(list []config.ProviderConfig) error {
	keys := make([]string, 0, len(list))
	for i, pc := range list {
		keys = append(keys, pc.Key)
		enc, err := s.box.Encrypt(pc.APIKey)
		if err != nil {
			return err
		}
		enabled := pc.Enabled == nil || *pc.Enabled
		var p model.Provider
		res := s.db.Where("config_key = ?", pc.Key).Limit(1).Find(&p)
		if res.Error != nil {
			return res.Error
		}
		key := pc.Key
		p.ConfigKey = &key
		p.Name = pc.Name
		p.Type = pc.Type
		p.BaseURL = strings.TrimSpace(pc.BaseURL)
		p.APIKeyEnc = enc
		p.Models = encodeModels(pc.Models, pc.Type)
		p.Enabled = enabled
		p.Source = model.SourceConfig
		p.SortOrder = i - 1000 // config providers first
		if res.RowsAffected == 0 {
			if err := s.db.Create(&p).Error; err != nil {
				return err
			}
		} else if err := s.db.Save(&p).Error; err != nil {
			return err
		}
	}
	q := s.db.Where("source = ?", model.SourceConfig)
	if len(keys) > 0 {
		q = q.Where("config_key NOT IN ?", keys)
	}
	return q.Delete(&model.Provider{}).Error
}

func (s *Providers) List(onlyEnabled bool) ([]model.Provider, error) {
	q := s.db.Order("sort_order ASC, id ASC")
	if onlyEnabled {
		q = q.Where("enabled = ?", true)
	}
	var out []model.Provider
	err := q.Find(&out).Error
	return out, err
}

func (s *Providers) Get(id uint) (*model.Provider, error) {
	var p model.Provider
	if err := s.db.First(&p, id).Error; err != nil {
		return nil, ErrNotFound
	}
	return &p, nil
}

func (s *Providers) MaskedKey(p *model.Provider) string {
	k, err := s.box.Decrypt(p.APIKeyEnc)
	if err != nil {
		return "(undecryptable)"
	}
	return secret.Mask(k)
}

type ProviderInput struct {
	Name    *string  `json:"name"`
	Type    *string  `json:"type"`
	BaseURL *string  `json:"base_url"`
	APIKey  *string  `json:"api_key"` // nil = keep current
	Models  []string `json:"models"`
	Enabled *bool    `json:"enabled"`
}

func validBaseURL(u string) bool {
	if u == "" {
		return true
	}
	parsed, err := url.Parse(u)
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func (s *Providers) Create(in ProviderInput) (*model.Provider, error) {
	if in.Name == nil || strings.TrimSpace(*in.Name) == "" || in.Type == nil {
		return nil, ErrInvalidProvider
	}
	typ := strings.ToLower(*in.Type)
	if typ != model.ProviderOpenAI && typ != model.ProviderGemini {
		return nil, ErrInvalidProvider
	}
	p := &model.Provider{Name: strings.TrimSpace(*in.Name), Type: typ, Source: model.SourceUI, Enabled: true}
	if in.BaseURL != nil {
		p.BaseURL = strings.TrimSpace(*in.BaseURL)
	}
	if !validBaseURL(p.BaseURL) {
		return nil, ErrInvalidProvider
	}
	if in.APIKey != nil {
		enc, err := s.box.Encrypt(strings.TrimSpace(*in.APIKey))
		if err != nil {
			return nil, err
		}
		p.APIKeyEnc = enc
	}
	p.Models = encodeModels(in.Models, typ)
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	var maxOrder int
	s.db.Model(&model.Provider{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&maxOrder)
	p.SortOrder = maxOrder + 1
	if err := s.db.Create(p).Error; err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Providers) Update(id uint, in ProviderInput) (*model.Provider, error) {
	p, err := s.Get(id)
	if err != nil {
		return nil, err
	}
	if p.Source == model.SourceConfig {
		return nil, ErrReadOnlyProvider
	}
	if in.Name != nil {
		if strings.TrimSpace(*in.Name) == "" {
			return nil, ErrInvalidProvider
		}
		p.Name = strings.TrimSpace(*in.Name)
	}
	if in.Type != nil {
		typ := strings.ToLower(*in.Type)
		if typ != model.ProviderOpenAI && typ != model.ProviderGemini {
			return nil, ErrInvalidProvider
		}
		p.Type = typ
	}
	if in.BaseURL != nil {
		if !validBaseURL(strings.TrimSpace(*in.BaseURL)) {
			return nil, ErrInvalidProvider
		}
		p.BaseURL = strings.TrimSpace(*in.BaseURL)
	}
	if in.APIKey != nil {
		enc, err := s.box.Encrypt(strings.TrimSpace(*in.APIKey))
		if err != nil {
			return nil, err
		}
		p.APIKeyEnc = enc
	}
	if in.Models != nil {
		p.Models = encodeModels(in.Models, p.Type)
	}
	if in.Enabled != nil {
		p.Enabled = *in.Enabled
	}
	if err := s.db.Save(p).Error; err != nil {
		return nil, err
	}
	return p, nil
}

func (s *Providers) Delete(id uint) error {
	p, err := s.Get(id)
	if err != nil {
		return err
	}
	if p.Source == model.SourceConfig {
		return ErrReadOnlyProvider
	}
	return s.db.Delete(p).Error
}

// Client builds an upstream client with the decrypted API key.
func (s *Providers) Client(p *model.Provider) (provider.Client, error) {
	key, err := s.box.Decrypt(p.APIKeyEnc)
	if err != nil {
		return nil, err
	}
	return s.NewClient(provider.Options{Type: p.Type, BaseURL: p.BaseURL, APIKey: key})
}
