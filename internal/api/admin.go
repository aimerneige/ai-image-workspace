package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/provider"
	"github.com/aimerneige/ai-image-workspace/internal/service"
)

func idParam(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "bad id")
		return 0, false
	}
	return uint(id), true
}

func (s *Server) handleAdminOverview(c *gin.Context) {
	n, _ := s.users.Count()
	c.JSON(http.StatusOK, gin.H{
		"version":            Version,
		"database":           s.cfg.Database.Driver,
		"allow_registration": s.cfg.Auth.AllowRegistration,
		"users":              n,
		"generation_timeout": s.cfg.Generate.Timeout.String(),
		"max_concurrent":     s.cfg.Generate.MaxConcurrentPerUser,
		"max_upload_mb":      s.cfg.Storage.MaxUploadMB,
		"default_models":     service.DefaultModels,
	})
}

func (s *Server) adminProvider(p *model.Provider) adminProviderDTO {
	d := adminProviderDTO{
		providerDTO: toProvider(p), BaseURL: p.BaseURL, APIKey: s.providers.MaskedKey(p), HasKey: p.APIKeyEnc != "",
		Enabled: p.Enabled, Source: p.Source, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
	if p.ConfigKey != nil {
		d.ConfigKey = *p.ConfigKey
	}
	return d
}

func (s *Server) handleAdminProviders(c *gin.Context) {
	list, err := s.providers.List(false)
	if err != nil {
		failErr(c, err)
		return
	}
	out := make([]adminProviderDTO, len(list))
	for i := range list {
		out[i] = s.adminProvider(&list[i])
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

func (s *Server) handleAdminCreateProvider(c *gin.Context) {
	var in service.ProviderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	p, err := s.providers.Create(in)
	if err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "provider.create", strconv.Itoa(int(p.ID)), gin.H{"name": p.Name, "type": p.Type})
	c.JSON(http.StatusCreated, s.adminProvider(p))
}

func (s *Server) handleAdminUpdateProvider(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var in service.ProviderInput
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	p, err := s.providers.Update(id, in)
	if err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "provider.update", c.Param("id"), gin.H{"name": p.Name, "api_key_changed": in.APIKey != nil})
	c.JSON(http.StatusOK, s.adminProvider(p))
}

func (s *Server) handleAdminDeleteProvider(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if err := s.providers.Delete(id); err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "provider.delete", c.Param("id"), nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleAdminTestProvider(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	p, err := s.providers.Get(id)
	if err != nil {
		failErr(c, err)
		return
	}
	client, err := s.providers.Client(p)
	if err != nil {
		failErr(c, err)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	start := time.Now()
	var first string
	if models := service.DecodeModels(p.Models); len(models) > 0 {
		first = models[0]
	}
	err = client.Test(ctx, first)
	res := gin.H{"ok": err == nil, "latency_ms": time.Since(start).Milliseconds()}
	if err != nil {
		res["error"] = err.Error()
		var pe *provider.Error
		if errors.As(err, &pe) && (pe.Status == http.StatusNotFound || pe.Status == http.StatusMethodNotAllowed) {
			res["hint"] = "check_base_url"
		}
	}
	s.audit.Log(actorOf(c), "provider.test", c.Param("id"), res)
	c.JSON(http.StatusOK, res)
}

func (s *Server) handleAdminUsers(c *gin.Context) {
	rows, err := s.users.List()
	if err != nil {
		failErr(c, err)
		return
	}
	out := make([]userDTO, len(rows))
	for i := range rows {
		out[i] = toUser(&rows[i].User)
		n := rows[i].Generations
		out[i].Generations = &n
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

func (s *Server) handleAdminCreateUser(c *gin.Context) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	if in.Role != model.RoleAdmin {
		in.Role = model.RoleUser
	}
	u, err := s.users.Create(in.Username, in.Password, in.Role)
	if err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "user.create", u.Username, gin.H{"role": u.Role})
	c.JSON(http.StatusCreated, toUser(u))
}

func (s *Server) handleAdminUpdateUser(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var in struct {
		Role     *string `json:"role"`
		Disabled *bool   `json:"disabled"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	u, err := s.users.Update(id, in.Role, in.Disabled)
	if err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "user.update", u.Username, in)
	c.JSON(http.StatusOK, toUser(u))
}

func (s *Server) handleAdminResetPassword(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	var in struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	u, err := s.users.Get(id)
	if err != nil {
		failErr(c, err)
		return
	}
	if err := s.users.SetPassword(id, in.Password); err != nil {
		failErr(c, err)
		return
	}
	s.users.DeleteSessionsFor(id, "")
	s.audit.Log(actorOf(c), "user.password_reset", u.Username, nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleAdminDeleteUser(c *gin.Context) {
	id, ok := idParam(c)
	if !ok {
		return
	}
	if id == currentUser(c).ID {
		fail(c, http.StatusBadRequest, "cannot_delete_self", "")
		return
	}
	u, err := s.users.Get(id)
	if err != nil {
		failErr(c, err)
		return
	}
	if err := s.users.Delete(id); err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "user.delete", u.Username, nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleAdminAudit(c *gin.Context) {
	p, ps := pageParams(c, 50, 200)
	f := service.AuditFilter{Action: c.Query("action"), Page: p, PageSize: ps}
	if v, err := strconv.ParseUint(c.Query("user_id"), 10, 64); err == nil {
		uid := uint(v)
		f.UserID = &uid
	}
	rows, total, err := s.audit.List(f)
	if err != nil {
		failErr(c, err)
		return
	}
	items := make([]auditDTO, len(rows))
	for i, r := range rows {
		items[i] = toAudit(r)
	}
	c.JSON(http.StatusOK, page[auditDTO]{Items: items, Total: total, Page: p, PageSize: ps})
}
