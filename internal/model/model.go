// Package model holds the GORM models shared by every package.
package model

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/schema"
)

// LongText maps to TEXT on sqlite/postgres and LONGTEXT on MySQL, where plain
// TEXT is capped at 64 KiB.
type LongText string

func (LongText) GormDataType() string { return "string" }

func (LongText) GormDBDataType(db *gorm.DB, _ *schema.Field) string {
	if db.Dialector.Name() == "mysql" {
		return "longtext"
	}
	return "text"
}

const (
	RoleAdmin = "admin"
	RoleUser  = "user"
)

type User struct {
	ID           uint   `gorm:"primaryKey"`
	Username     string `gorm:"size:64;uniqueIndex;not null"`
	PasswordHash string `gorm:"size:255;not null"`
	Role         string `gorm:"size:16;not null;default:user"`
	Disabled     bool   `gorm:"not null;default:false"`
	LastLoginAt  *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

func (u *User) IsAdmin() bool { return u.Role == RoleAdmin }

// Session stores the SHA-256 of the cookie token, never the token itself.
type Session struct {
	ID         string    `gorm:"size:64;primaryKey"`
	UserID     uint      `gorm:"index;not null"`
	User       *User     `gorm:"constraint:OnDelete:CASCADE"`
	ExpiresAt  time.Time `gorm:"index;not null"`
	LastSeenAt time.Time
	IP         string `gorm:"size:64"`
	UserAgent  string `gorm:"size:512"`
	CreatedAt  time.Time
}

const (
	ProviderOpenAI = "openai"
	ProviderGemini = "gemini"

	SourceConfig = "config"
	SourceUI     = "ui"
)

type Provider struct {
	ID uint `gorm:"primaryKey"`
	// ConfigKey links providers declared in the config file; NULL for UI ones.
	ConfigKey *string `gorm:"size:64;uniqueIndex"`
	Name      string  `gorm:"size:128;not null"`
	Type      string  `gorm:"size:16;not null"`
	BaseURL   string  `gorm:"size:512"`
	// APIKeyEnc is AES-GCM encrypted; see internal/secret.
	APIKeyEnc string   `gorm:"type:text"`
	Models    LongText // JSON array of model ids
	Enabled   bool     `gorm:"not null;default:true"`
	Source    string   `gorm:"size:16;not null;default:ui"`
	SortOrder int      `gorm:"not null;default:0"`
	CreatedAt time.Time
	UpdatedAt time.Time
}

const (
	StatusQueued    = "queued"
	StatusRunning   = "running"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
	StatusCanceled  = "canceled"

	ModeGenerate = "generate"
	ModeEdit     = "edit"
)

type Generation struct {
	ID           string `gorm:"size:36;primaryKey"`
	UserID       uint   `gorm:"index;not null"`
	ProviderID   uint   `gorm:"index"`
	ProviderName string `gorm:"size:128"`
	ProviderType string `gorm:"size:16"`
	Model        string `gorm:"size:128;index"`
	Mode         string `gorm:"size:16"`
	Prompt       LongText
	Params       LongText // JSON
	Status       string   `gorm:"size:16;index;not null"`
	Error        LongText
	// RequestLog is the upstream request with binary payloads stripped.
	RequestLog LongText
	// ResponseMeta holds usage, model text output and other upstream metadata.
	ResponseMeta LongText
	DurationMs   int64
	Favorite     bool `gorm:"not null;default:false;index"`
	StartedAt    *time.Time
	FinishedAt   *time.Time
	CreatedAt    time.Time `gorm:"index"`
	UpdatedAt    time.Time
	DeletedAt    gorm.DeletedAt `gorm:"index"`
	Images       []Image        `gorm:"foreignKey:GenerationID"`
}

const (
	ImageInput  = "input"
	ImageOutput = "output"
)

type Image struct {
	ID           string `gorm:"size:36;primaryKey"`
	UserID       uint   `gorm:"index;not null"`
	GenerationID string `gorm:"size:36;index"`
	Role         string `gorm:"size:16;not null"`
	Position     int    `gorm:"not null;default:0"`
	Path         string `gorm:"size:512;not null"`
	ThumbPath    string `gorm:"size:512"`
	MimeType     string `gorm:"size:64"`
	Width        int
	Height       int
	Bytes        int64
	CreatedAt    time.Time
}

type AuditLog struct {
	ID        uint   `gorm:"primaryKey"`
	UserID    *uint  `gorm:"index"`
	Username  string `gorm:"size:64"`
	Action    string `gorm:"size:64;index;not null"`
	Target    string `gorm:"size:128"`
	Detail    LongText
	IP        string    `gorm:"size:64"`
	UserAgent string    `gorm:"size:512"`
	CreatedAt time.Time `gorm:"index"`
}

func All() []any {
	return []any{&User{}, &Session{}, &Provider{}, &Generation{}, &Image{}, &AuditLog{}}
}
