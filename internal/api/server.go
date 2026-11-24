// Package api exposes the HTTP API and serves the compiled frontend.
package api

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/aimerneige/ai-image-workspace/internal/config"
	"github.com/aimerneige/ai-image-workspace/internal/service"
	"github.com/aimerneige/ai-image-workspace/internal/storage"
)

const RepoURL = "https://github.com/aimerneige/ai-image-workspace"

// Version is overridden at build time with -ldflags "-X ...api.Version=...".
var Version = "dev"

type Server struct {
	cfg       *config.Config
	users     *service.Users
	providers *service.Providers
	gens      *service.Generations
	audit     *service.Audit
	store     *storage.Store
	static    fs.FS
}

type Deps struct {
	Config      *config.Config
	Users       *service.Users
	Providers   *service.Providers
	Generations *service.Generations
	Audit       *service.Audit
	Store       *storage.Store
	// Static is the built frontend; nil disables SPA serving.
	Static fs.FS
}

func New(d Deps) *Server {
	return &Server{
		cfg: d.Config, users: d.Users, providers: d.Providers, gens: d.Generations,
		audit: d.Audit, store: d.Store, static: d.Static,
	}
}

func (s *Server) Handler() http.Handler {
	if s.cfg.Server.Mode == "debug" {
		gin.SetMode(gin.DebugMode)
	} else {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Recovery(), requestLogger())
	_ = r.SetTrustedProxies(s.cfg.Server.TrustedProxies)
	r.MaxMultipartMemory = 32 << 20

	api := r.Group("/api", s.csrf, noStore)
	api.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	api.GET("/meta", s.handleMeta)

	authLimiter := s.rateLimit(newLimiter(20, 10*time.Minute))
	api.POST("/auth/login", authLimiter, s.handleLogin)
	api.POST("/auth/register", authLimiter, s.handleRegister)
	api.POST("/auth/logout", s.handleLogout)

	authed := api.Group("", s.requireAuth)
	authed.GET("/auth/me", s.handleMe)
	authed.PUT("/account/password", s.handleChangePassword)
	authed.GET("/account/activity", s.handleMyActivity)
	authed.GET("/stats", s.handleStats)
	authed.GET("/providers", s.handleProviders)

	authed.POST("/generations", s.handleCreateGeneration)
	authed.GET("/generations", s.handleListGenerations)
	authed.GET("/generations/:id", s.handleGetGeneration)
	authed.PATCH("/generations/:id", s.handlePatchGeneration)
	authed.POST("/generations/:id/cancel", s.handleCancelGeneration)
	authed.DELETE("/generations/:id", s.handleDeleteGeneration)

	// Images are fetched by <img> tags, so they live outside noStore caching.
	r.GET("/api/images/:id", s.requireAuth, s.handleImage)

	admin := authed.Group("/admin", s.requireAdmin)
	admin.GET("/overview", s.handleAdminOverview)
	admin.GET("/providers", s.handleAdminProviders)
	admin.POST("/providers", s.handleAdminCreateProvider)
	admin.PUT("/providers/:id", s.handleAdminUpdateProvider)
	admin.DELETE("/providers/:id", s.handleAdminDeleteProvider)
	admin.POST("/providers/:id/test", s.handleAdminTestProvider)
	admin.GET("/users", s.handleAdminUsers)
	admin.POST("/users", s.handleAdminCreateUser)
	admin.PATCH("/users/:id", s.handleAdminUpdateUser)
	admin.PUT("/users/:id/password", s.handleAdminResetPassword)
	admin.DELETE("/users/:id", s.handleAdminDeleteUser)
	admin.GET("/audit-logs", s.handleAdminAudit)

	r.NoRoute(s.serveSPA)
	return r
}

func noStore(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Next()
}

func requestLogger() gin.HandlerFunc {
	return gin.LoggerWithConfig(gin.LoggerConfig{SkipPaths: []string{"/api/health"}})
}

// serveSPA serves built assets and falls back to index.html for client routes.
func (s *Server) serveSPA(c *gin.Context) {
	p := c.Request.URL.Path
	if strings.HasPrefix(p, "/api/") || s.static == nil || (c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead) {
		fail(c, http.StatusNotFound, "not_found", "")
		return
	}
	name := strings.TrimPrefix(path.Clean(p), "/")
	if name != "" && name != "index.html" {
		if st, err := fs.Stat(s.static, name); err == nil && !st.IsDir() {
			if strings.HasPrefix(name, "assets/") {
				c.Header("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				c.Header("Cache-Control", "public, max-age=3600")
			}
			c.FileFromFS(name, http.FS(s.static))
			return
		}
		// Missing asset files should 404 instead of returning HTML.
		if path.Ext(name) != "" {
			c.Status(http.StatusNotFound)
			return
		}
	}
	data, err := fs.ReadFile(s.static, "index.html")
	if err != nil {
		c.String(http.StatusNotFound, "frontend not built: run `npm run build` in web/")
		return
	}
	c.Header("Cache-Control", "no-cache")
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}
