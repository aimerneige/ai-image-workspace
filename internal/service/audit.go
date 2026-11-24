package service

import (
	"encoding/json"
	"log/slog"

	"gorm.io/gorm"

	"github.com/aimerneige/ai-image-workspace/internal/model"
)

// Actor identifies who performed an action and from where.
type Actor struct {
	UserID    uint
	Username  string
	IP        string
	UserAgent string
}

type Audit struct{ db *gorm.DB }

func NewAudit(db *gorm.DB) *Audit { return &Audit{db: db} }

// Log records an action. Failures are logged but never block the caller.
func (a *Audit) Log(actor Actor, action, target string, detail any) {
	entry := model.AuditLog{
		Username:  actor.Username,
		Action:    action,
		Target:    target,
		IP:        actor.IP,
		UserAgent: truncateStr(actor.UserAgent, 500),
	}
	if actor.UserID != 0 {
		id := actor.UserID
		entry.UserID = &id
	}
	if detail != nil {
		if b, err := json.Marshal(detail); err == nil {
			entry.Detail = model.LongText(b)
		}
	}
	if err := a.db.Create(&entry).Error; err != nil {
		slog.Error("write audit log", "action", action, "err", err)
	}
}

type AuditFilter struct {
	UserID   *uint
	Action   string
	Page     int
	PageSize int
}

func (a *Audit) List(f AuditFilter) ([]model.AuditLog, int64, error) {
	q := a.db.Model(&model.AuditLog{})
	if f.UserID != nil {
		q = q.Where("user_id = ?", *f.UserID)
	}
	if f.Action != "" {
		q = q.Where("action LIKE ?", f.Action+"%")
	}
	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []model.AuditLog
	err := q.Order("id DESC").Offset((f.Page - 1) * f.PageSize).Limit(f.PageSize).Find(&rows).Error
	return rows, total, err
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
