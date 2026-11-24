package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/aimerneige/ai-image-workspace/internal/model"
	"github.com/aimerneige/ai-image-workspace/internal/provider"
	"github.com/aimerneige/ai-image-workspace/internal/service"
)

func pageParams(c *gin.Context, def, maxSize int) (int, int) {
	p, _ := strconv.Atoi(c.Query("page"))
	ps, _ := strconv.Atoi(c.Query("page_size"))
	if p < 1 {
		p = 1
	}
	if ps < 1 {
		ps = def
	}
	if ps > maxSize {
		ps = maxSize
	}
	return p, ps
}

func (s *Server) handleMeta(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"version":            Version,
		"allow_registration": s.cfg.Auth.AllowRegistration,
		"repo_url":           RepoURL,
		"max_upload_mb":      s.cfg.Storage.MaxUploadMB,
	})
}

// ---- auth ----------------------------------------------------------------

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) handleLogin(c *gin.Context) {
	var in credentials
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	actor := actorOf(c)
	actor.Username = strings.TrimSpace(in.Username)
	u, err := s.users.Authenticate(in.Username, in.Password)
	if err != nil {
		s.audit.Log(actor, "auth.login_failed", actor.Username, map[string]any{"reason": err.Error()})
		failErr(c, err)
		return
	}
	s.startSession(c, u, "auth.login")
}

func (s *Server) startSession(c *gin.Context, u *model.User, action string) {
	token, exp, err := s.users.CreateSession(u.ID, c.ClientIP(), c.Request.UserAgent())
	if err != nil {
		failErr(c, err)
		return
	}
	s.setCookie(c, token, exp)
	s.audit.Log(service.Actor{UserID: u.ID, Username: u.Username, IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}, action, "", nil)
	c.JSON(http.StatusOK, gin.H{"user": toUser(u)})
}

func (s *Server) handleRegister(c *gin.Context) {
	if !s.cfg.Auth.AllowRegistration {
		fail(c, http.StatusForbidden, "registration_disabled", "")
		return
	}
	var in credentials
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	u, err := s.users.Create(in.Username, in.Password, "")
	if err != nil {
		failErr(c, err)
		return
	}
	s.startSession(c, u, "auth.register")
}

func (s *Server) handleLogout(c *gin.Context) {
	if token, _ := c.Cookie(cookieName); token != "" {
		if u, err := s.users.ResolveSession(token); err == nil {
			s.audit.Log(service.Actor{UserID: u.ID, Username: u.Username, IP: c.ClientIP(), UserAgent: c.Request.UserAgent()}, "auth.logout", "", nil)
		}
		s.users.DeleteSession(token)
	}
	s.clearCookie(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleMe(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"user": toUser(currentUser(c))})
}

func (s *Server) handleChangePassword(c *gin.Context) {
	var in struct {
		Current string `json:"current_password"`
		Next    string `json:"new_password"`
	}
	if err := c.ShouldBindJSON(&in); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	u := currentUser(c)
	if err := s.users.ChangePassword(u, in.Current, in.Next); err != nil {
		if err == service.ErrInvalidCredentials {
			fail(c, http.StatusBadRequest, "wrong_password", "")
			return
		}
		failErr(c, err)
		return
	}
	token, _ := c.Cookie(cookieName)
	s.users.DeleteSessionsFor(u.ID, token)
	s.audit.Log(actorOf(c), "account.password_change", "", nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleMyActivity(c *gin.Context) {
	p, ps := pageParams(c, 30, 100)
	uid := currentUser(c).ID
	rows, total, err := s.audit.List(service.AuditFilter{UserID: &uid, Page: p, PageSize: ps})
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

func (s *Server) handleStats(c *gin.Context) {
	c.JSON(http.StatusOK, s.gens.Stats(currentUser(c).ID))
}

func (s *Server) handleProviders(c *gin.Context) {
	list, err := s.providers.List(true)
	if err != nil {
		failErr(c, err)
		return
	}
	out := make([]providerDTO, len(list))
	for i := range list {
		out[i] = toProvider(&list[i])
	}
	c.JSON(http.StatusOK, gin.H{"items": out})
}

// ---- generations ---------------------------------------------------------

type createGenerationBody struct {
	ProviderID   uint            `json:"provider_id"`
	Model        string          `json:"model"`
	Prompt       string          `json:"prompt"`
	Params       provider.Params `json:"params"`
	ReferenceIDs []string        `json:"reference_image_ids"`
}

// handleCreateGeneration accepts either JSON or multipart/form-data with a
// "payload" JSON field plus any number of "images" files.
func (s *Server) handleCreateGeneration(c *gin.Context) {
	maxFile := int64(s.cfg.Storage.MaxUploadMB) << 20
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFile*16+(4<<20))

	var body createGenerationBody
	var uploads [][]byte
	if strings.HasPrefix(c.ContentType(), "multipart/") {
		form, err := c.MultipartForm()
		if err != nil {
			fail(c, http.StatusRequestEntityTooLarge, "upload_too_large", err.Error())
			return
		}
		if err := json.Unmarshal([]byte(firstValue(form.Value["payload"])), &body); err != nil {
			fail(c, http.StatusBadRequest, "invalid_request", "payload must be JSON")
			return
		}
		for _, fh := range form.File["images"] {
			if fh.Size > maxFile {
				fail(c, http.StatusRequestEntityTooLarge, "upload_too_large", fh.Filename)
				return
			}
			f, err := fh.Open()
			if err != nil {
				failErr(c, err)
				return
			}
			data, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				failErr(c, err)
				return
			}
			uploads = append(uploads, data)
		}
	} else if err := c.ShouldBindJSON(&body); err != nil {
		fail(c, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	gen, err := s.gens.Create(service.CreateInput{
		Actor: actorOf(c), ProviderID: body.ProviderID, Model: body.Model, Prompt: body.Prompt,
		Params: body.Params, Uploads: uploads, ReferenceIDs: body.ReferenceIDs,
	})
	if err != nil {
		failErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, toGeneration(gen, false))
}

func firstValue(v []string) string {
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

func (s *Server) handleListGenerations(c *gin.Context) {
	p, ps := pageParams(c, 24, 100)
	rows, total, err := s.gens.List(service.GenFilter{
		UserID: currentUser(c).ID, Query: strings.TrimSpace(c.Query("q")), Status: c.Query("status"),
		ProviderType: c.Query("provider_type"), Model: c.Query("model"), Mode: c.Query("mode"),
		Favorite: c.Query("favorite") == "true", Page: p, PageSize: ps,
	})
	if err != nil {
		failErr(c, err)
		return
	}
	items := make([]generationDTO, len(rows))
	for i := range rows {
		items[i] = toGeneration(&rows[i], false)
	}
	c.JSON(http.StatusOK, page[generationDTO]{Items: items, Total: total, Page: p, PageSize: ps})
}

func (s *Server) handleGetGeneration(c *gin.Context) {
	gen, err := s.gens.Get(c.Param("id"), currentUser(c).ID)
	if err != nil {
		failErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toGeneration(gen, true))
}

func (s *Server) handlePatchGeneration(c *gin.Context) {
	var in struct {
		Favorite *bool `json:"favorite"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Favorite == nil {
		fail(c, http.StatusBadRequest, "invalid_request", "")
		return
	}
	if err := s.gens.SetFavorite(c.Param("id"), currentUser(c).ID, *in.Favorite); err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "generation.favorite", c.Param("id"), map[string]any{"favorite": *in.Favorite})
	c.Status(http.StatusNoContent)
}

func (s *Server) handleCancelGeneration(c *gin.Context) {
	if err := s.gens.Cancel(c.Param("id"), currentUser(c).ID); err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "generation.cancel", c.Param("id"), nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleDeleteGeneration(c *gin.Context) {
	if err := s.gens.Delete(c.Param("id"), currentUser(c).ID); err != nil {
		failErr(c, err)
		return
	}
	s.audit.Log(actorOf(c), "generation.delete", c.Param("id"), nil)
	c.Status(http.StatusNoContent)
}

func (s *Server) handleImage(c *gin.Context) {
	img, err := s.gens.Image(c.Param("id"))
	u := currentUser(c)
	if err != nil || (img.UserID != u.ID && !u.IsAdmin()) {
		fail(c, http.StatusNotFound, "not_found", "")
		return
	}
	rel := img.Path
	if c.Query("variant") == "thumb" && img.ThumbPath != "" {
		rel = img.ThumbPath
	}
	abs, err := s.store.Abs(rel)
	if err != nil {
		fail(c, http.StatusNotFound, "not_found", "")
		return
	}
	// Image ids are immutable, so they can be cached aggressively.
	c.Header("Cache-Control", "private, max-age=31536000, immutable")
	if c.Query("download") == "1" {
		name := fmt.Sprintf("aiw-%s-%s%s", time.Now().Format("20060102"), img.ID[:8], filepath.Ext(img.Path))
		c.FileAttachment(abs, name)
		return
	}
	c.File(abs)
}
