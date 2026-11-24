package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"github.com/aimerneige/ai-image-workspace/internal/model"
)

var (
	ErrInvalidCredentials = errors.New("invalid_credentials")
	ErrUserDisabled       = errors.New("user_disabled")
	ErrUsernameTaken      = errors.New("username_taken")
	ErrInvalidUsername    = errors.New("invalid_username")
	ErrWeakPassword       = errors.New("weak_password")
	ErrNotFound           = errors.New("not_found")
	ErrLastAdmin          = errors.New("last_admin")
)

var (
	dummyOnce sync.Once
	dummyHash []byte
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_.\-]{3,32}$`)

type Users struct {
	db  *gorm.DB
	ttl time.Duration
}

func NewUsers(db *gorm.DB, ttl time.Duration) *Users { return &Users{db: db, ttl: ttl} }

func ValidatePassword(pw string) error {
	if len(pw) < 8 || len(pw) > 128 {
		return ErrWeakPassword
	}
	return nil
}

func hashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	return string(b), err
}

func (s *Users) Count() (int64, error) {
	var n int64
	err := s.db.Model(&model.User{}).Count(&n).Error
	return n, err
}

// Create adds a user. When role is empty the very first user becomes admin.
func (s *Users) Create(username, password, role string) (*model.User, error) {
	username = strings.TrimSpace(username)
	if !usernameRe.MatchString(username) {
		return nil, ErrInvalidUsername
	}
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return nil, err
	}
	var u *model.User
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var exists int64
		if err := tx.Model(&model.User{}).Where("LOWER(username) = ?", strings.ToLower(username)).Count(&exists).Error; err != nil {
			return err
		}
		if exists > 0 {
			return ErrUsernameTaken
		}
		if role == "" {
			var n int64
			if err := tx.Model(&model.User{}).Count(&n).Error; err != nil {
				return err
			}
			role = model.RoleUser
			if n == 0 {
				role = model.RoleAdmin
			}
		}
		u = &model.User{Username: username, PasswordHash: hash, Role: role}
		return tx.Create(u).Error
	})
	if err != nil {
		return nil, err
	}
	return u, nil
}

// SeedAdmin creates the configured admin when there are no users yet.
func (s *Users) SeedAdmin(username, password string) error {
	if username == "" || password == "" {
		return nil
	}
	n, err := s.Count()
	if err != nil || n > 0 {
		return err
	}
	if _, err := s.Create(username, password, model.RoleAdmin); err != nil {
		return err
	}
	slog.Info("created initial admin user", "username", username)
	return nil
}

func (s *Users) Authenticate(username, password string) (*model.User, error) {
	var u model.User
	err := s.db.Where("LOWER(username) = ?", strings.ToLower(strings.TrimSpace(username))).First(&u).Error
	if err != nil {
		// Spend comparable time to avoid user enumeration by timing.
		dummyOnce.Do(func() { dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dummy-password"), bcrypt.DefaultCost) })
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return nil, ErrInvalidCredentials
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)) != nil {
		return nil, ErrInvalidCredentials
	}
	if u.Disabled {
		return nil, ErrUserDisabled
	}
	now := time.Now()
	s.db.Model(&u).Update("last_login_at", now)
	u.LastLoginAt = &now
	return &u, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateSession returns the raw cookie token; only its hash is stored.
func (s *Users) CreateSession(userID uint, ip, ua string) (string, time.Time, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", time.Time{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(buf)
	exp := time.Now().Add(s.ttl)
	sess := model.Session{
		ID: hashToken(token), UserID: userID, ExpiresAt: exp, LastSeenAt: time.Now(),
		IP: ip, UserAgent: truncateStr(ua, 500),
	}
	if err := s.db.Create(&sess).Error; err != nil {
		return "", time.Time{}, err
	}
	return token, exp, nil
}

// ResolveSession returns the user for a cookie token, sliding the expiry.
func (s *Users) ResolveSession(token string) (*model.User, error) {
	if token == "" {
		return nil, ErrNotFound
	}
	var sess model.Session
	if err := s.db.Preload("User").Where("id = ?", hashToken(token)).First(&sess).Error; err != nil {
		return nil, ErrNotFound
	}
	if time.Now().After(sess.ExpiresAt) || sess.User == nil {
		s.db.Delete(&sess)
		return nil, ErrNotFound
	}
	if sess.User.Disabled {
		return nil, ErrUserDisabled
	}
	if time.Since(sess.LastSeenAt) > 10*time.Minute {
		s.db.Model(&sess).Updates(map[string]any{"last_seen_at": time.Now(), "expires_at": time.Now().Add(s.ttl)})
	}
	return sess.User, nil
}

func (s *Users) DeleteSession(token string) {
	s.db.Where("id = ?", hashToken(token)).Delete(&model.Session{})
}

func (s *Users) DeleteSessionsFor(userID uint, exceptToken string) {
	q := s.db.Where("user_id = ?", userID)
	if exceptToken != "" {
		q = q.Where("id <> ?", hashToken(exceptToken))
	}
	q.Delete(&model.Session{})
}

func (s *Users) PurgeExpiredSessions() {
	s.db.Where("expires_at < ?", time.Now()).Delete(&model.Session{})
}

func (s *Users) ChangePassword(u *model.User, current, next string) error {
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(current)) != nil {
		return ErrInvalidCredentials
	}
	return s.SetPassword(u.ID, next)
}

func (s *Users) SetPassword(userID uint, pw string) error {
	if err := ValidatePassword(pw); err != nil {
		return err
	}
	hash, err := hashPassword(pw)
	if err != nil {
		return err
	}
	return s.db.Model(&model.User{}).Where("id = ?", userID).Update("password_hash", hash).Error
}

func (s *Users) IDByName(username string) (uint, error) {
	var u model.User
	if err := s.db.Where("LOWER(username) = ?", strings.ToLower(strings.TrimSpace(username))).First(&u).Error; err != nil {
		return 0, ErrNotFound
	}
	return u.ID, nil
}

func (s *Users) Get(id uint) (*model.User, error) {
	var u model.User
	if err := s.db.First(&u, id).Error; err != nil {
		return nil, ErrNotFound
	}
	return &u, nil
}

type UserRow struct {
	model.User
	Generations int64 `json:"generations"`
}

func (s *Users) List() ([]UserRow, error) {
	var users []model.User
	if err := s.db.Order("id ASC").Find(&users).Error; err != nil {
		return nil, err
	}
	type cnt struct {
		UserID uint
		N      int64
	}
	var counts []cnt
	s.db.Model(&model.Generation{}).Select("user_id, COUNT(*) AS n").Group("user_id").Scan(&counts)
	m := map[uint]int64{}
	for _, c := range counts {
		m[c.UserID] = c.N
	}
	out := make([]UserRow, len(users))
	for i, u := range users {
		out[i] = UserRow{User: u, Generations: m[u.ID]}
	}
	return out, nil
}

func (s *Users) countActiveAdmins(tx *gorm.DB) int64 {
	var n int64
	tx.Model(&model.User{}).Where("role = ? AND disabled = ?", model.RoleAdmin, false).Count(&n)
	return n
}

// Update changes role/disabled while guaranteeing one active admin remains.
func (s *Users) Update(id uint, role *string, disabled *bool) (*model.User, error) {
	var out model.User
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&out, id).Error; err != nil {
			return ErrNotFound
		}
		wasActiveAdmin := out.Role == model.RoleAdmin && !out.Disabled
		if role != nil {
			if *role != model.RoleAdmin && *role != model.RoleUser {
				return errors.New("invalid role")
			}
			out.Role = *role
		}
		if disabled != nil {
			out.Disabled = *disabled
		}
		stillActiveAdmin := out.Role == model.RoleAdmin && !out.Disabled
		if wasActiveAdmin && !stillActiveAdmin && s.countActiveAdmins(tx) <= 1 {
			return ErrLastAdmin
		}
		if err := tx.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{"role": out.Role, "disabled": out.Disabled}).Error; err != nil {
			return err
		}
		if out.Disabled {
			tx.Where("user_id = ?", id).Delete(&model.Session{})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Users) Delete(id uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var u model.User
		if err := tx.First(&u, id).Error; err != nil {
			return ErrNotFound
		}
		if u.Role == model.RoleAdmin && !u.Disabled && s.countActiveAdmins(tx) <= 1 {
			return ErrLastAdmin
		}
		tx.Where("user_id = ?", id).Delete(&model.Session{})
		return tx.Delete(&u).Error
	})
}
