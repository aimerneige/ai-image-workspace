package api

import (
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/provider"
	"github.com/aimerneige/ai-image-workspace/internal/service"
)

const (
	cookieName = "aiw_session"
	ctxUser    = "aiw.user"
	// csrfHeader must be present on state-changing requests. Browsers cannot
	// add custom headers to cross-site form posts, so this blocks CSRF.
	csrfHeader = "X-Requested-With"
)

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message,omitempty"`
}

func fail(c *gin.Context, status int, code, msg string) {
	c.AbortWithStatusJSON(status, gin.H{"error": apiError{Code: code, Message: msg}})
}

// failErr maps service errors to HTTP responses with stable error codes that
// the frontend translates.
func failErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrInvalidCredentials):
		fail(c, http.StatusUnauthorized, "invalid_credentials", "")
	case errors.Is(err, service.ErrUserDisabled):
		fail(c, http.StatusForbidden, "user_disabled", "")
	case errors.Is(err, service.ErrUsernameTaken):
		fail(c, http.StatusConflict, "username_taken", "")
	case errors.Is(err, service.ErrInvalidUsername):
		fail(c, http.StatusBadRequest, "invalid_username", "")
	case errors.Is(err, service.ErrWeakPassword):
		fail(c, http.StatusBadRequest, "weak_password", "")
	case errors.Is(err, service.ErrNotFound):
		fail(c, http.StatusNotFound, "not_found", "")
	case errors.Is(err, service.ErrLastAdmin):
		fail(c, http.StatusConflict, "last_admin", "")
	case errors.Is(err, service.ErrReadOnlyProvider):
		fail(c, http.StatusForbidden, "provider_read_only", "")
	case errors.Is(err, service.ErrProviderDisabled):
		fail(c, http.StatusBadRequest, "provider_disabled", "")
	case errors.Is(err, service.ErrInvalidProvider):
		fail(c, http.StatusBadRequest, "invalid_provider", "")
	case errors.Is(err, service.ErrTooManyRunning):
		fail(c, http.StatusTooManyRequests, "too_many_running", "")
	case errors.Is(err, service.ErrUnknownModel):
		fail(c, http.StatusBadRequest, "unknown_model", "")
	case errors.Is(err, service.ErrNotRunning):
		fail(c, http.StatusConflict, "not_running", "")
	case errors.Is(err, provider.ErrInvalid):
		fail(c, http.StatusBadRequest, "invalid_request", err.Error())
	default:
		fail(c, http.StatusInternalServerError, "internal", err.Error())
	}
}

func currentUser(c *gin.Context) *model.User {
	if v, ok := c.Get(ctxUser); ok {
		return v.(*model.User)
	}
	return nil
}

func actorOf(c *gin.Context) service.Actor {
	a := service.Actor{IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}
	if u := currentUser(c); u != nil {
		a.UserID, a.Username = u.ID, u.Username
	}
	return a
}

func (s *Server) csrf(c *gin.Context) {
	switch c.Request.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
	default:
		if c.GetHeader(csrfHeader) == "" {
			fail(c, http.StatusForbidden, "csrf", "missing "+csrfHeader+" header")
			return
		}
	}
	c.Next()
}

func (s *Server) requireAuth(c *gin.Context) {
	token, _ := c.Cookie(cookieName)
	u, err := s.users.ResolveSession(token)
	if err != nil {
		s.clearCookie(c)
		fail(c, http.StatusUnauthorized, "unauthorized", "")
		return
	}
	c.Set(ctxUser, u)
	c.Next()
}

func (s *Server) requireAdmin(c *gin.Context) {
	if u := currentUser(c); u == nil || !u.IsAdmin() {
		fail(c, http.StatusForbidden, "forbidden", "")
		return
	}
	c.Next()
}

func (s *Server) setCookie(c *gin.Context, token string, exp time.Time) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", Expires: exp, MaxAge: int(time.Until(exp).Seconds()),
		HttpOnly: true, Secure: s.cfg.Auth.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name: cookieName, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.cfg.Auth.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

// limiter is a fixed-window counter keyed by client IP, used for auth endpoints.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*window
}

type window struct {
	start time.Time
	n     int
}

func newLimiter(max int, w time.Duration) *limiter {
	return &limiter{max: max, window: w, hits: map[string]*window{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if len(l.hits) > 10000 {
		for k, v := range l.hits {
			if now.Sub(v.start) > l.window {
				delete(l.hits, k)
			}
		}
	}
	w, ok := l.hits[key]
	if !ok || now.Sub(w.start) > l.window {
		l.hits[key] = &window{start: now, n: 1}
		return true
	}
	w.n++
	return w.n <= l.max
}

func (s *Server) rateLimit(l *limiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !l.allow(c.ClientIP()) {
			fail(c, http.StatusTooManyRequests, "rate_limited", "")
			return
		}
		c.Next()
	}
}
