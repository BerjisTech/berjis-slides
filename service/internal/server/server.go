package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	coreauth "github.com/berjistech/berjis-ecosystem/shared/coreauth"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/jmoiron/sqlx"
)

type Options struct {
	AllowedOrigins, CoreAPIBase string
	DB                          *sqlx.DB
	UploadsDir                  string
	UploadsPublicBase           string
	UploadsProvider             string
}

type Slide struct {
	ID        string          `db:"id" json:"id"`
	UserID    string          `db:"user_id" json:"userId"`
	Title     *string         `db:"title" json:"title,omitempty"`
	Data      json.RawMessage `db:"data" json:"data,omitempty"`
	Status    string          `db:"status" json:"status"`
	CreatedAt time.Time       `db:"created_at" json:"createdAt"`
	UpdatedAt time.Time       `db:"updated_at" json:"updatedAt"`
}

const maxUploadBytes = 25 << 20

func New(opts Options) *fiber.App {
	app := fiber.New()
	uploadsDir := strings.TrimSpace(opts.UploadsDir)
	if uploadsDir == "" {
		uploadsDir = "./docker-data/uploads"
	}
	if abs, err := filepath.Abs(uploadsDir); err == nil {
		uploadsDir = abs
	}
	if err := os.MkdirAll(uploadsDir, 0o755); err != nil {
		fmt.Printf("warn: unable to create uploads dir %s: %v\n", uploadsDir, err)
	}
	uploadsPublicBase := strings.TrimSpace(opts.UploadsPublicBase)
	uploadProvider := strings.TrimSpace(opts.UploadsProvider)
	if uploadProvider == "" {
		uploadProvider = "local"
	}

	httpClientAuth := &http.Client{Timeout: 5 * time.Second}
	var authVerifier *coreauth.Verifier
	coreAPIBase := strings.TrimSpace(opts.CoreAPIBase)
	if coreAPIBase != "" {
		if v, err := coreauth.NewVerifier(coreauth.Config{
			CoreAPIBase: coreAPIBase,
			HTTPClient:  httpClientAuth,
		}); err != nil {
			fmt.Printf("warn: slides coreauth verifier init failed: %v\n", err)
		} else {
			authVerifier = v
		}
	}
	corsPolicy := newOriginPolicy(strings.TrimSpace(opts.AllowedOrigins))
	app.Use(func(c *fiber.Ctx) error {
		origin := c.Get("Origin")
		if origin != "" && corsPolicy.Allows(origin) {
			c.Set("Access-Control-Allow-Origin", origin)
			c.Set("Vary", "Origin")
			c.Set("Access-Control-Allow-Credentials", "true")
			c.Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			c.Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept")
			if c.Method() == fiber.MethodOptions {
				return c.SendStatus(fiber.StatusNoContent)
			}
		} else if c.Method() == fiber.MethodOptions {
			return c.SendStatus(fiber.StatusNoContent)
		}
		return c.Next()
	})

	app.Static("/uploads", fiber.Static{
		Dir:      uploadsDir,
		Browse:   false,
		MaxAge:   3600,
		Compress: false,
	})

	app.Post("/v1/uploads", func(c *fiber.Ctx) error {
		userID, err := getUID(c)
		if err != nil {
			return err
		}
		file, err := c.FormFile("file")
		if err != nil {
			return fiber.NewError(fiber.StatusBadRequest, "file field is required")
		}
		if file.Size <= 0 {
			return fiber.NewError(fiber.StatusBadRequest, "file is empty")
		}
		if file.Size > maxUploadBytes {
			return fiber.NewError(fiber.StatusRequestEntityTooLarge, "file exceeds 25MB limit")
		}
		contentType := file.Header.Get("Content-Type")
		if !strings.HasPrefix(strings.ToLower(contentType), "image/") {
			return fiber.NewError(fiber.StatusBadRequest, "only image uploads are allowed")
		}
		userDir := filepath.Join(uploadsDir, userID)
		if err := os.MkdirAll(userDir, 0o755); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "unable to prepare uploads directory")
		}
		ext := strings.ToLower(filepath.Ext(file.Filename))
		if ext == "" {
			if exts, err := mime.ExtensionsByType(contentType); err == nil && len(exts) > 0 {
				ext = exts[0]
			}
		}
		if ext == "" {
			ext = ".img"
		}
		filename := uuid.NewString() + ext
		destPath := filepath.Join(userDir, filename)
		if err := c.SaveFile(file, destPath); err != nil {
			return fiber.NewError(fiber.StatusInternalServerError, "failed to write upload")
		}
		relativePath := path.Join(userID, filename)
		publicURL := strings.TrimSpace(uploadsPublicBase)
		if publicURL != "" {
			publicURL = strings.TrimRight(publicURL, "/") + "/" + relativePath
		} else {
			publicURL = path.Join("/uploads", relativePath)
		}
		return c.JSON(fiber.Map{
			"success":     true,
			"id":          filename,
			"name":        file.Filename,
			"size":        file.Size,
			"url":         publicURL,
			"path":        relativePath,
			"provider":    uploadProvider,
			"contentType": contentType,
		})
	})

	app.Get("/v1/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"success": true}) })

	getUID := func(c *fiber.Ctx) (string, error) {
		authz := strings.TrimSpace(c.Get("Authorization"))
		token := bearerToken(authz)
		if token != "" && authVerifier != nil {
			if claims, err := authVerifier.Verify(token); err == nil {
				if uuid := strings.TrimSpace(claims.UUID); uuid != "" {
					return uuid, nil
				}
			} else {
				if errors.Is(err, coreauth.ErrTokenInvalid) || errors.Is(err, coreauth.ErrTokenExpired) || errors.Is(err, coreauth.ErrTokenMissing) {
					return "", fiber.ErrUnauthorized
				}
				if !errors.Is(err, coreauth.ErrJWKSUnavailable) {
					fmt.Printf("warn: slides coreauth verify failed: %v\n", err)
				}
			}
		}

		if coreAPIBase == "" {
			return "", fiber.ErrUnauthorized
		}
		req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(coreAPIBase, "/")+"/v1/auth/verify", nil)
		if authz != "" {
			req.Header.Set("Authorization", authz)
		}
		if v := c.Get("Cookie"); v != "" {
			req.Header.Set("Cookie", v)
		}
		if v := c.Get("Origin"); v != "" {
			req.Header.Set("Origin", v)
		}
		req.Header.Set("Accept", "application/json")
		resp, err := httpClientAuth.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		var raw map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			return "", err
		}
		data, _ := raw["data"].(map[string]any)
		if data == nil {
			return "", fiber.ErrUnauthorized
		}
		if ok, _ := data["valid"].(bool); !ok {
			return "", fiber.ErrUnauthorized
		}
		if uuidStr, ok := data["uuid"].(string); ok && strings.TrimSpace(uuidStr) != "" {
			return strings.TrimSpace(uuidStr), nil
		}
		if uidAny, ok := data["uid"]; ok {
			switch v := uidAny.(type) {
			case float64:
				return fmt.Sprintf("%0.0f", v), nil
			case string:
				if s := strings.TrimSpace(v); s != "" {
					return s, nil
				}
			}
		}
		if s, ok := data["userId"].(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s), nil
		}
		return "", fiber.ErrUnauthorized
	}

	setStatus := func(c *fiber.Ctx, status string) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var s Slide
		if err := opts.DB.Get(&s, `UPDATE slides SET status=$1, updated_at=now() WHERE id=$2 AND (
        user_id=$3 OR EXISTS(SELECT 1 FROM slide_collaborators sc WHERE sc.slide_id=$2 AND sc.user_id=$3 AND sc.role='editor')
      )
        RETURNING id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at`, status, id, uid); err != nil {
			return c.Status(404).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": s})
	}

	// List
	app.Get("/v1/slides", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		statuses := c.Query("status", "active")
		q := `SELECT id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at FROM slides s
              WHERE (s.user_id=$1 OR EXISTS (SELECT 1 FROM slide_collaborators c WHERE c.slide_id=s.id AND c.user_id=$1))
                AND s.status = ANY(string_to_array($2, ','))
              ORDER BY s.updated_at DESC`
		out := []Slide{}
		if err := opts.DB.Select(&out, q, uid, statuses); err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": out})
	})

	// Get
	app.Get("/v1/slides/:id", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var s Slide
		if err := opts.DB.Get(&s, `SELECT id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at FROM slides s
            WHERE s.id=$1 AND (s.user_id=$2 OR EXISTS (SELECT 1 FROM slide_collaborators c WHERE c.slide_id=s.id AND c.user_id=$2))`, id, uid); err != nil {
			return c.Status(404).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": s})
	})

	type slideIn struct {
		Title  *string         `json:"title"`
		Data   json.RawMessage `json:"data"`
		Status *string         `json:"status"`
	}
	// Create
	app.Post("/v1/slides", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		var in slideIn
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false})
		}
		hasTitle := in.Title != nil && strings.TrimSpace(*in.Title) != ""
		hasData := len(in.Data) > 2
		if !hasTitle && !hasData {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "empty"})
		}
		var s Slide
		if err := opts.DB.Get(&s, `INSERT INTO slides (user_id, title, data, status)
            VALUES ($1, NULLIF($2,''), NULLIF($3,'null'::jsonb), COALESCE(NULLIF($4,''),'active'))
            RETURNING id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at`, uid, optStr(in.Title), defaultJSON(in.Data), optStr(in.Status)); err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": s})
	})

	// Update
	app.Put("/v1/slides/:id", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var in slideIn
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false})
		}
		var s Slide
		if err := opts.DB.Get(&s, `UPDATE slides SET
            title = NULLIF($1,''), data = NULLIF($2,'null'::jsonb), status = COALESCE(NULLIF($3,''), status), updated_at = now()
            WHERE id=$4 AND (
              user_id=$5 OR EXISTS (SELECT 1 FROM slide_collaborators sc WHERE sc.slide_id=$4 AND sc.user_id=$5 AND sc.role='editor')
            )
            RETURNING id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at`, optStr(in.Title), defaultJSON(in.Data), optStr(in.Status), id, uid); err != nil {
			return c.Status(404).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": s})
	})

	// Comment-only: update speaker notes (owner, editor, commenter)
	app.Post("/v1/slides/:id/notes", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var body struct {
			Notes json.RawMessage `json:"notes"`
		}
		if err := c.BodyParser(&body); err != nil {
			return fiber.ErrBadRequest
		}
		if len(body.Notes) == 0 {
			body.Notes = json.RawMessage("null")
		}
		var s Slide
		if err := opts.DB.Get(&s, `UPDATE slides SET data = jsonb_set(COALESCE(data,'{}'::jsonb), '{notes}', COALESCE($1,'null'::jsonb), true), updated_at=now()
        WHERE id=$2 AND (
          user_id=$3 OR EXISTS(SELECT 1 FROM slide_collaborators sc WHERE sc.slide_id=$2 AND sc.user_id=$3 AND sc.role IN ('commenter','editor'))
        )
        RETURNING id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at`, defaultJSON(body.Notes), id, uid); err != nil {
			return c.Status(403).JSON(fiber.Map{"success": false, "message": "forbidden"})
		}
		return c.JSON(fiber.Map{"success": true, "data": s})
	})

	app.Post("/v1/slides/:id/archive", func(c *fiber.Ctx) error { return setStatus(c, "archived") })
	app.Post("/v1/slides/:id/restore", func(c *fiber.Ctx) error { return setStatus(c, "active") })
	app.Delete("/v1/slides/:id", func(c *fiber.Ctx) error { return setStatus(c, "deleted") })

	// Collaborators (owner-managed)
	app.Get("/v1/slides/:id/collaborators", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var owner string
		if err := opts.DB.Get(&owner, `SELECT user_id FROM slides WHERE id=$1`, id); err != nil {
			return fiber.ErrNotFound
		}
		if owner != uid {
			return fiber.ErrForbidden
		}
		type row struct {
			UserID, Role, InvitedBy string
			CreatedAt               time.Time
		}
		rows := []row{}
		_ = opts.DB.Select(&rows, `SELECT user_id, role, invited_by, created_at FROM slide_collaborators WHERE slide_id=$1 ORDER BY created_at DESC`, id)
		return c.JSON(fiber.Map{"success": true, "data": rows})
	})
	app.Post("/v1/slides/:id/collaborators", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var owner string
		if err := opts.DB.Get(&owner, `SELECT user_id FROM slides WHERE id=$1`, id); err != nil {
			return fiber.ErrNotFound
		}
		if owner != uid {
			return fiber.ErrForbidden
		}
		var body struct{ UserID, Role string }
		if err := c.BodyParser(&body); err != nil {
			return fiber.ErrBadRequest
		}
		role := strings.ToLower(strings.TrimSpace(body.Role))
		if body.UserID == "" || (role != "viewer" && role != "commenter" && role != "editor") {
			return fiber.ErrBadRequest
		}
		if _, err := opts.DB.Exec(`INSERT INTO slide_collaborators (slide_id, user_id, role, invited_by) VALUES ($1,$2,$3,$4)
		  ON CONFLICT (slide_id, user_id) DO UPDATE SET role=EXCLUDED.role, updated_at=now()`, id, body.UserID, role, uid); err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true})
	})
	app.Delete("/v1/slides/:id/collaborators", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		id := c.Params("id")
		var owner string
		if err := opts.DB.Get(&owner, `SELECT user_id FROM slides WHERE id=$1`, id); err != nil {
			return fiber.ErrNotFound
		}
		if owner != uid {
			return fiber.ErrForbidden
		}
		userID := strings.TrimSpace(c.Query("user_id"))
		if userID == "" {
			return fiber.ErrBadRequest
		}
		if _, err := opts.DB.Exec(`DELETE FROM slide_collaborators WHERE slide_id=$1 AND user_id=$2`, id, userID); err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true})
	})

	return app
}

type originPolicy struct {
	allowAll   bool
	exact      map[string]struct{}
	hostExact  map[string]struct{}
	hostSuffix []string
}

func newOriginPolicy(raw string) originPolicy {
	policy := originPolicy{
		exact:     make(map[string]struct{}),
		hostExact: make(map[string]struct{}),
	}
	tokens := splitOrigins(raw)
	if len(tokens) == 0 {
		tokens = []string{"https://berjis.tech", "*.berjis.tech"}
	}
	for _, token := range tokens {
		value := strings.TrimSpace(token)
		if value == "" {
			continue
		}
		if value == "*" {
			policy.allowAll = true
			continue
		}
		lower := strings.ToLower(value)
		if strings.HasPrefix(lower, "*.") {
			policy.hostSuffix = append(policy.hostSuffix, strings.TrimPrefix(lower, "*."))
			continue
		}
		if strings.Contains(lower, "://") {
			if strings.Contains(lower, "*") {
				if u, err := url.Parse(lower); err == nil {
					host := strings.ToLower(u.Hostname())
					if strings.HasPrefix(host, "*.") {
						policy.hostSuffix = append(policy.hostSuffix, strings.TrimPrefix(host, "*."))
						continue
					}
					if host != "" {
						policy.hostExact[host] = struct{}{}
					}
				}
				continue
			}
			policy.exact[lower] = struct{}{}
			if u, err := url.Parse(lower); err == nil {
				host := strings.ToLower(u.Hostname())
				if host != "" {
					policy.hostExact[host] = struct{}{}
				}
			}
			continue
		}
		hostOnly := strings.ToLower(value)
		if idx := strings.Index(hostOnly, ":"); idx > -1 {
			hostOnly = hostOnly[:idx]
		}
		if hostOnly != "" {
			policy.hostExact[hostOnly] = struct{}{}
		}
	}
	return policy
}

func splitOrigins(raw string) []string {
	if raw == "" {
		return nil
	}
	return strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t'
	})
}

func (p originPolicy) Allows(origin string) bool {
	if origin == "" {
		return false
	}
	if p.allowAll {
		return true
	}
	lower := strings.ToLower(origin)
	if _, ok := p.exact[lower]; ok {
		return true
	}
	host := hostFromOrigin(origin)
	if _, ok := p.hostExact[host]; ok {
		return true
	}
	for _, suffix := range p.hostSuffix {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func hostFromOrigin(origin string) string {
	if u, err := url.Parse(origin); err == nil {
		host := u.Hostname()
		if host != "" {
			return strings.ToLower(host)
		}
	}
	return strings.ToLower(origin)
}

func optStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func defaultJSON(j json.RawMessage) json.RawMessage {
	if len(j) == 0 {
		return json.RawMessage("null")
	}
	return j
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	return ""
}
