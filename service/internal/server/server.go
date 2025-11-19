package server

import (
	"database/sql"
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

type Presentation struct {
	ID        string    `db:"id" json:"id"`
	OwnerID   string    `db:"owner_id" json:"ownerId"`
	Title     string    `db:"title" json:"title"`
	Status    string    `db:"status" json:"status"`
	CreatedAt time.Time `db:"created_at" json:"createdAt"`
	UpdatedAt time.Time `db:"updated_at" json:"updatedAt"`
}

type presentationSlideRow struct {
	ID             string    `db:"id"`
	PresentationID string    `db:"presentation_id"`
	Name           string    `db:"name"`
	Layout         string    `db:"layout"`
	Background     string    `db:"background"`
	Position       int       `db:"position"`
	CreatedAt      time.Time `db:"created_at"`
	UpdatedAt      time.Time `db:"updated_at"`
}

type slideElementRow struct {
	ID        string          `db:"id"`
	SlideID   string          `db:"slide_id"`
	Type      string          `db:"element_type"`
	X         float64         `db:"x"`
	Y         float64         `db:"y"`
	Width     float64         `db:"width"`
	Height    float64         `db:"height"`
	Rotation  float64         `db:"rotation"`
	ZIndex    int             `db:"z_index"`
	Locked    bool            `db:"locked"`
	Hidden    bool            `db:"hidden"`
	Props     json.RawMessage `db:"props"`
	CreatedAt time.Time       `db:"created_at"`
	UpdatedAt time.Time       `db:"updated_at"`
}

type slidePayload struct {
	ID         string           `json:"id"`
	Name       string           `json:"name"`
	Layout     string           `json:"layout"`
	Background string           `json:"background"`
	Position   int              `json:"position"`
	Elements   []elementPayload `json:"elements"`
	CreatedAt  time.Time        `json:"createdAt"`
	UpdatedAt  time.Time        `json:"updatedAt"`
	Meta       map[string]any   `json:"meta,omitempty"`
}

type elementPayload struct {
	ID       string                 `json:"id"`
	Type     string                 `json:"type"`
	X        float64                `json:"x"`
	Y        float64                `json:"y"`
	Width    float64                `json:"width"`
	Height   float64                `json:"height"`
	Rotation float64                `json:"rotation"`
	ZIndex   int                    `json:"zIndex"`
	Locked   bool                   `json:"locked"`
	Hidden   bool                   `json:"hidden"`
	Props    map[string]interface{} `json:"props"`
	Created  time.Time              `json:"createdAt"`
	Updated  time.Time              `json:"updatedAt"`
}

type slideCreateInput struct {
	Name       string         `json:"name"`
	Layout     string         `json:"layout"`
	Background string         `json:"background"`
	Position   *int           `json:"position"`
	Elements   []elementInput `json:"elements"`
}

type slideUpdateInput struct {
	Name       *string `json:"name"`
	Layout     *string `json:"layout"`
	Background *string `json:"background"`
}

type elementInput struct {
	SlideID  string                 `json:"slideId"`
	Type     string                 `json:"type"`
	X        float64                `json:"x"`
	Y        float64                `json:"y"`
	Width    float64                `json:"width"`
	Height   float64                `json:"height"`
	Rotation float64                `json:"rotation"`
	ZIndex   *int                   `json:"zIndex"`
	Locked   *bool                  `json:"locked"`
	Hidden   *bool                  `json:"hidden"`
	Props    map[string]interface{} `json:"props"`
}

type reorderInput struct {
	Order []string `json:"order"`
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

	app.Static("/uploads", uploadsDir)

	getUID := makeGetUID(authVerifier, coreAPIBase, httpClientAuth)

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

	// getUID := func(c *fiber.Ctx) (string, error) {
	// 	authz := strings.TrimSpace(c.Get("Authorization"))
	// 	token := bearerToken(authz)
	// 	if token != "" && authVerifier != nil {
	// 		if claims, err := authVerifier.Verify(token); err == nil {
	// 			if uuid := strings.TrimSpace(claims.UUID); uuid != "" {
	// 				return uuid, nil
	// 			}
	// 		} else {
	// 			if errors.Is(err, coreauth.ErrTokenInvalid) || errors.Is(err, coreauth.ErrTokenExpired) || errors.Is(err, coreauth.ErrTokenMissing) {
	// 				return "", fiber.ErrUnauthorized
	// 			}
	// 			if !errors.Is(err, coreauth.ErrJWKSUnavailable) {
	// 				fmt.Printf("warn: slides coreauth verify failed: %v\n", err)
	// 			}
	// 		}
	// 	}

	// 	if coreAPIBase == "" {
	// 		return "", fiber.ErrUnauthorized
	// 	}
	// 	req, _ := http.NewRequest(http.MethodPost, strings.TrimRight(coreAPIBase, "/")+"/v1/auth/verify", nil)
	// 	if authz != "" {
	// 		req.Header.Set("Authorization", authz)
	// 	}
	// 	if v := c.Get("Cookie"); v != "" {
	// 		req.Header.Set("Cookie", v)
	// 	}
	// 	if v := c.Get("Origin"); v != "" {
	// 		req.Header.Set("Origin", v)
	// 	}
	// 	req.Header.Set("Accept", "application/json")
	// 	resp, err := httpClientAuth.Do(req)
	// 	if err != nil {
	// 		return "", err
	// 	}
	// 	defer resp.Body.Close()
	// 	var raw map[string]any
	// 	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
	// 		return "", err
	// 	}
	// 	data, _ := raw["data"].(map[string]any)
	// 	if data == nil {
	// 		return "", fiber.ErrUnauthorized
	// 	}
	// 	if ok, _ := data["valid"].(bool); !ok {
	// 		return "", fiber.ErrUnauthorized
	// 	}
	// 	if uuidStr, ok := data["uuid"].(string); ok && strings.TrimSpace(uuidStr) != "" {
	// 		return strings.TrimSpace(uuidStr), nil
	// 	}
	// 	if uidAny, ok := data["uid"]; ok {
	// 		switch v := uidAny.(type) {
	// 		case float64:
	// 			return fmt.Sprintf("%0.0f", v), nil
	// 		case string:
	// 			if s := strings.TrimSpace(v); s != "" {
	// 				return s, nil
	// 			}
	// 		}
	// 	}
	// 	if s, ok := data["userId"].(string); ok && strings.TrimSpace(s) != "" {
	// 		return strings.TrimSpace(s), nil
	// 	}
	// 	return "", fiber.ErrUnauthorized
	// }

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

	// Phase 3 Presentation APIs
	app.Get("/v1/presentations/:id/slides", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canView(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		slides, err := loadPresentationSlides(opts.DB, presentationID, nil)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": slides})
	})

	app.Post("/v1/presentations/:id/slides", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		var in slideCreateInput
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "invalid payload"})
		}
		slide, err := createPresentationSlide(opts.DB, presentationID, in)
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": slide})
	})

	app.Put("/v1/presentations/:id/slides/:slideId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		slideID := c.Params("slideId")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		if err := ensureSlideInPresentation(opts.DB, presentationID, slideID); err != nil {
			return fiberErr(c, err)
		}
		var in slideUpdateInput
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "invalid payload"})
		}
		if err := updatePresentationSlide(opts.DB, slideID, in); err != nil {
			return fiberErr(c, err)
		}
		slides, err := loadPresentationSlides(opts.DB, presentationID, []string{slideID})
		if err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		if len(slides) == 0 {
			return c.Status(404).JSON(fiber.Map{"success": false})
		}
		return c.JSON(fiber.Map{"success": true, "data": slides[0]})
	})

	app.Delete("/v1/presentations/:id/slides/:slideId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		slideID := c.Params("slideId")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		if err := ensureSlideInPresentation(opts.DB, presentationID, slideID); err != nil {
			return fiberErr(c, err)
		}
		if _, err := opts.DB.Exec(`DELETE FROM presentation_slides WHERE id=$1`, slideID); err != nil {
			return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true})
	})

	app.Put("/v1/presentations/:id/slides/reorder", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		var in reorderInput
		if err := c.BodyParser(&in); err != nil || len(in.Order) == 0 {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "order required"})
		}
		if err := reorderPresentationSlides(opts.DB, presentationID, in.Order); err != nil {
			return fiberErr(c, err)
		}
		return c.JSON(fiber.Map{"success": true})
	})

	app.Post("/v1/presentations/:id/elements", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		var in elementInput
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "invalid payload"})
		}
		if in.SlideID == "" {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "slideId required"})
		}
		if err := ensureSlideInPresentation(opts.DB, presentationID, in.SlideID); err != nil {
			return fiberErr(c, err)
		}
		element, err := createSlideElement(opts.DB, in)
		if err != nil {
			return fiberErr(c, err)
		}
		return c.JSON(fiber.Map{"success": true, "data": element})
	})

	app.Put("/v1/presentations/:id/elements/:elementId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		elementID := c.Params("elementId")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		slideID, err := ensureElementInPresentation(opts.DB, presentationID, elementID)
		if err != nil {
			return fiberErr(c, err)
		}
		var in elementInput
		if err := c.BodyParser(&in); err != nil {
			return c.Status(400).JSON(fiber.Map{"success": false, "message": "invalid payload"})
		}
		if in.SlideID == "" {
			in.SlideID = slideID
		}
		if err := ensureSlideInPresentation(opts.DB, presentationID, in.SlideID); err != nil {
			return fiberErr(c, err)
		}
		if err := updateSlideElement(opts.DB, elementID, in); err != nil {
			return fiberErr(c, err)
		}
		element, err := getSlideElement(opts.DB, elementID)
		if err != nil {
			return fiberErr(c, err)
		}
		return c.JSON(fiber.Map{"success": true, "data": element})
	})

	app.Delete("/v1/presentations/:id/elements/:elementId", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		elementID := c.Params("elementId")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		if _, err := ensureElementInPresentation(opts.DB, presentationID, elementID); err != nil {
			return fiberErr(c, err)
		}
		if _, err := opts.DB.Exec(`DELETE FROM slide_elements WHERE id=$1`, elementID); err != nil {
			return fiberErr(c, err)
		}
		return c.JSON(fiber.Map{"success": true})
	})

	app.Post("/v1/presentations/:id/duplicate", func(c *fiber.Ctx) error {
		if opts.DB == nil {
			return c.Status(500).JSON(fiber.Map{"success": false})
		}
		uid, err := getUID(c)
		if err != nil {
			return c.Status(401).JSON(fiber.Map{"success": false})
		}
		presentationID := c.Params("id")
		role, err := presentationRole(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		if !canEdit(role) {
			return c.Status(403).JSON(fiber.Map{"success": false})
		}
		cloned, err := duplicatePresentation(opts.DB, presentationID, uid)
		if err != nil {
			return fiberErr(c, err)
		}
		return c.JSON(fiber.Map{"success": true, "data": cloned})
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

func makeGetUID(verifier *coreauth.Verifier, coreAPIBase string, client *http.Client) func(*fiber.Ctx) (string, error) {
	return func(c *fiber.Ctx) (string, error) {
		authz := strings.TrimSpace(c.Get("Authorization"))
		token := bearerToken(authz)
		if token != "" && verifier != nil {
			if claims, err := verifier.Verify(token); err == nil {
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

		if coreAPIBase == "" || client == nil {
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
		resp, err := client.Do(req)
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
}

func fiberErr(c *fiber.Ctx, err error) error {
	if err == nil {
		return c.Status(500).JSON(fiber.Map{"success": false})
	}
	var fe *fiber.Error
	if errors.As(err, &fe) {
		return c.Status(fe.Code).JSON(fiber.Map{"success": false, "message": fe.Message})
	}
	return c.Status(500).JSON(fiber.Map{"success": false, "message": err.Error()})
}

func presentationRole(db *sqlx.DB, presentationID, userID string) (string, error) {
	if db == nil {
		return "", fiber.ErrInternalServerError
	}
	var result struct {
		Role string `db:"role"`
	}
	query := `
SELECT CASE
  WHEN p.owner_id = $2 THEN 'owner'
  WHEN EXISTS(SELECT 1 FROM presentation_shares s WHERE s.presentation_id = p.id AND s.user_id = $2 AND s.permission = 'editor') THEN 'editor'
  WHEN EXISTS(SELECT 1 FROM presentation_shares s WHERE s.presentation_id = p.id AND s.user_id = $2 AND s.permission = 'commenter') THEN 'commenter'
  WHEN EXISTS(SELECT 1 FROM presentation_shares s WHERE s.presentation_id = p.id AND s.user_id = $2) THEN 'viewer'
  ELSE ''
END AS role
FROM presentations p
WHERE p.id = $1`
	if err := db.Get(&result, query, presentationID, userID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fiber.ErrNotFound
		}
		return "", err
	}
	if result.Role == "" {
		return "", fiber.ErrForbidden
	}
	return result.Role, nil
}

func canView(role string) bool {
	return role == "owner" || role == "editor" || role == "commenter" || role == "viewer"
}

func canEdit(role string) bool {
	return role == "owner" || role == "editor"
}

func ensureSlideInPresentation(db *sqlx.DB, presentationID, slideID string) error {
	var exists bool
	if err := db.Get(&exists, `SELECT TRUE FROM presentation_slides WHERE id=$1 AND presentation_id=$2`, slideID, presentationID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fiber.ErrNotFound
		}
		return err
	}
	return nil
}

func ensureElementInPresentation(db *sqlx.DB, presentationID, elementID string) (string, error) {
	var slideID string
	query := `
SELECT ps.presentation_id, se.slide_id
FROM slide_elements se
JOIN presentation_slides ps ON ps.id = se.slide_id
WHERE se.id = $1`
	var row struct {
		PresentationID string `db:"presentation_id"`
		SlideID        string `db:"slide_id"`
	}
	if err := db.Get(&row, query, elementID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", fiber.ErrNotFound
		}
		return "", err
	}
	if row.PresentationID != presentationID {
		return "", fiber.ErrForbidden
	}
	slideID = row.SlideID
	return slideID, nil
}

func loadPresentationSlides(db *sqlx.DB, presentationID string, filterIDs []string) ([]slidePayload, error) {
	slides := []presentationSlideRow{}
	baseQuery := `SELECT id, presentation_id, name, layout, background, position, created_at, updated_at FROM presentation_slides WHERE presentation_id=$1`
	args := []interface{}{presentationID}
	if len(filterIDs) > 0 {
		query, params, err := sqlx.In(baseQuery+` AND id IN (?) ORDER BY position, created_at`, filterIDs)
		if err != nil {
			return nil, err
		}
		query = db.Rebind(query)
		if err := db.Select(&slides, query, params...); err != nil {
			return nil, err
		}
	} else {
		if err := db.Select(&slides, baseQuery+` ORDER BY position, created_at`, args...); err != nil {
			return nil, err
		}
	}
	if len(slides) == 0 {
		return []slidePayload{}, nil
	}
	ids := make([]string, len(slides))
	for i, slide := range slides {
		ids[i] = slide.ID
	}
	elementsBySlide := map[string][]elementPayload{}
	query, params, err := sqlx.In(`SELECT id, slide_id, element_type, x, y, width, height, rotation, z_index, locked, hidden, props, created_at, updated_at FROM slide_elements WHERE slide_id IN (?) ORDER BY z_index, created_at`, ids)
	if err != nil {
		return nil, err
	}
	query = db.Rebind(query)
	elementRows := []slideElementRow{}
	if err := db.Select(&elementRows, query, params...); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}
	for _, row := range elementRows {
		payload, _ := mapElementRow(row)
		elementsBySlide[row.SlideID] = append(elementsBySlide[row.SlideID], payload)
	}
	out := make([]slidePayload, len(slides))
	for i, slide := range slides {
		out[i] = slidePayload{
			ID:         slide.ID,
			Name:       slide.Name,
			Layout:     slide.Layout,
			Background: slide.Background,
			Position:   slide.Position,
			Elements:   elementsBySlide[slide.ID],
			CreatedAt:  slide.CreatedAt,
			UpdatedAt:  slide.UpdatedAt,
		}
	}
	return out, nil
}

func createPresentationSlide(db *sqlx.DB, presentationID string, in slideCreateInput) (slidePayload, error) {
	tx, err := db.Beginx()
	if err != nil {
		return slidePayload{}, err
	}
	defer tx.Rollback()
	if strings.TrimSpace(in.Name) == "" {
		in.Name = "Slide"
	}
	if strings.TrimSpace(in.Layout) == "" {
		in.Layout = "blank"
	}
	if strings.TrimSpace(in.Background) == "" {
		in.Background = "#ffffff"
	}
	position := 0
	if in.Position != nil {
		position = *in.Position
	} else {
		if err := tx.Get(&position, `SELECT COALESCE(MAX(position)+1,0) FROM presentation_slides WHERE presentation_id=$1`, presentationID); err != nil {
			return slidePayload{}, err
		}
	}
	var slideID string
	if err := tx.Get(&slideID, `INSERT INTO presentation_slides (presentation_id, name, layout, background, position)
        VALUES ($1,$2,$3,$4,$5) RETURNING id`, presentationID, in.Name, in.Layout, in.Background, position); err != nil {
		return slidePayload{}, err
	}
	if len(in.Elements) > 0 {
		for _, element := range in.Elements {
			element.SlideID = slideID
			if _, err := insertElementTx(tx, element); err != nil {
				return slidePayload{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return slidePayload{}, err
	}
	slides, err := loadPresentationSlides(db, presentationID, []string{slideID})
	if err != nil || len(slides) == 0 {
		return slidePayload{}, err
	}
	return slides[0], nil
}

func updatePresentationSlide(db *sqlx.DB, slideID string, in slideUpdateInput) error {
	setParts := []string{}
	args := []interface{}{}
	if in.Name != nil {
		setParts = append(setParts, fmt.Sprintf("name=$%d", len(args)+1))
		args = append(args, strings.TrimSpace(*in.Name))
	}
	if in.Layout != nil {
		setParts = append(setParts, fmt.Sprintf("layout=$%d", len(args)+1))
		args = append(args, strings.TrimSpace(*in.Layout))
	}
	if in.Background != nil {
		setParts = append(setParts, fmt.Sprintf("background=$%d", len(args)+1))
		args = append(args, strings.TrimSpace(*in.Background))
	}
	if len(setParts) == 0 {
		return nil
	}
	args = append(args, slideID)
	query := fmt.Sprintf("UPDATE presentation_slides SET %s, updated_at=now() WHERE id=$%d", strings.Join(setParts, ", "), len(args))
	_, err := db.Exec(query, args...)
	return err
}

func reorderPresentationSlides(db *sqlx.DB, presentationID string, order []string) error {
	tx, err := db.Beginx()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for idx, slideID := range order {
		if _, err := tx.Exec(`UPDATE presentation_slides SET position=$1, updated_at=now() WHERE id=$2 AND presentation_id=$3`, idx, slideID, presentationID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func createSlideElement(db *sqlx.DB, in elementInput) (elementPayload, error) {
	tx, err := db.Beginx()
	if err != nil {
		return elementPayload{}, err
	}
	defer tx.Rollback()
	payload, err := insertElementTx(tx, in)
	if err != nil {
		return elementPayload{}, err
	}
	if err := tx.Commit(); err != nil {
		return elementPayload{}, err
	}
	return payload, nil
}

func insertElementTx(tx *sqlx.Tx, in elementInput) (elementPayload, error) {
	if strings.TrimSpace(in.Type) == "" {
		return elementPayload{}, fiber.NewError(fiber.StatusBadRequest, "type required")
	}
	propsJSON, err := json.Marshal(in.Props)
	if err != nil {
		return elementPayload{}, err
	}
	if string(propsJSON) == "null" {
		propsJSON = []byte("{}")
	}
	if in.ZIndex == nil {
		var maxZ sql.NullInt32
		if err := tx.Get(&maxZ, `SELECT COALESCE(MAX(z_index), -1) FROM slide_elements WHERE slide_id=$1`, in.SlideID); err != nil {
			return elementPayload{}, err
		}
		val := int(maxZ.Int32) + 1
		in.ZIndex = &val
	}
	lockVal := false
	if in.Locked != nil {
		lockVal = *in.Locked
	}
	hiddenVal := false
	if in.Hidden != nil {
		hiddenVal = *in.Hidden
	}
	var elementID string
	if err := tx.Get(&elementID, `INSERT INTO slide_elements (slide_id, element_type, x, y, width, height, rotation, z_index, locked, hidden, props)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
		in.SlideID, in.Type, in.X, in.Y, in.Width, in.Height, in.Rotation, *in.ZIndex, lockVal, hiddenVal, propsJSON); err != nil {
		return elementPayload{}, err
	}
	return elementPayload{
		ID:       elementID,
		Type:     in.Type,
		X:        in.X,
		Y:        in.Y,
		Width:    in.Width,
		Height:   in.Height,
		Rotation: in.Rotation,
		ZIndex:   *in.ZIndex,
		Locked:   lockVal,
		Hidden:   hiddenVal,
		Props:    in.Props,
	}, nil
}

func updateSlideElement(db *sqlx.DB, elementID string, in elementInput) error {
	propsJSON, err := json.Marshal(in.Props)
	if err != nil {
		return err
	}
	if string(propsJSON) == "null" {
		propsJSON = []byte("{}")
	}
	lockVal := false
	if in.Locked != nil {
		lockVal = *in.Locked
	}
	hiddenVal := false
	if in.Hidden != nil {
		hiddenVal = *in.Hidden
	}
	if in.ZIndex == nil {
		current := 0
		if err := db.Get(&current, `SELECT z_index FROM slide_elements WHERE id=$1`, elementID); err != nil {
			return err
		}
		in.ZIndex = &current
	}
	_, err = db.Exec(`UPDATE slide_elements SET slide_id=$1, element_type=$2, x=$3, y=$4, width=$5, height=$6, rotation=$7, z_index=$8, locked=$9, hidden=$10, props=$11, updated_at=now() WHERE id=$12`,
		in.SlideID, in.Type, in.X, in.Y, in.Width, in.Height, in.Rotation, *in.ZIndex, lockVal, hiddenVal, propsJSON, elementID)
	return err
}

func getSlideElement(db *sqlx.DB, elementID string) (elementPayload, error) {
	var row slideElementRow
	if err := db.Get(&row, `SELECT id, slide_id, element_type, x, y, width, height, rotation, z_index, locked, hidden, props, created_at, updated_at FROM slide_elements WHERE id=$1`, elementID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return elementPayload{}, fiber.ErrNotFound
		}
		return elementPayload{}, err
	}
	return mapElementRow(row)
}

func mapElementRow(row slideElementRow) (elementPayload, error) {
	props := map[string]interface{}{}
	if len(row.Props) > 0 {
		_ = json.Unmarshal(row.Props, &props)
	}
	return elementPayload{
		ID:       row.ID,
		Type:     row.Type,
		X:        row.X,
		Y:        row.Y,
		Width:    row.Width,
		Height:   row.Height,
		Rotation: row.Rotation,
		ZIndex:   row.ZIndex,
		Locked:   row.Locked,
		Hidden:   row.Hidden,
		Props:    props,
		Created:  row.CreatedAt,
		Updated:  row.UpdatedAt,
	}, nil
}

func duplicatePresentation(db *sqlx.DB, presentationID, userID string) (Presentation, error) {
	tx, err := db.Beginx()
	if err != nil {
		return Presentation{}, err
	}
	defer tx.Rollback()
	var base Presentation
	if err := tx.Get(&base, `SELECT id, owner_id, title, status, created_at, updated_at FROM presentations WHERE id=$1`, presentationID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Presentation{}, fiber.ErrNotFound
		}
		return Presentation{}, err
	}
	newTitle := base.Title + " (Copy)"
	var newPresentationID string
	if err := tx.Get(&newPresentationID, `INSERT INTO presentations (owner_id, title, status) VALUES ($1,$2,$3) RETURNING id`, userID, newTitle, base.Status); err != nil {
		return Presentation{}, err
	}
	slides := []presentationSlideRow{}
	if err := tx.Select(&slides, `SELECT id, presentation_id, name, layout, background, position, created_at, updated_at FROM presentation_slides WHERE presentation_id=$1 ORDER BY position`, presentationID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Presentation{}, err
	}
	for _, slide := range slides {
		var newSlideID string
		if err := tx.Get(&newSlideID, `INSERT INTO presentation_slides (presentation_id, name, layout, background, position) VALUES ($1,$2,$3,$4,$5) RETURNING id`, newPresentationID, slide.Name, slide.Layout, slide.Background, slide.Position); err != nil {
			return Presentation{}, err
		}
		elements := []slideElementRow{}
		if err := tx.Select(&elements, `SELECT id, slide_id, element_type, x, y, width, height, rotation, z_index, locked, hidden, props, created_at, updated_at FROM slide_elements WHERE slide_id=$1`, slide.ID); err != nil && !errors.Is(err, sql.ErrNoRows) {
			return Presentation{}, err
		}
		for _, element := range elements {
			if _, err := tx.Exec(`INSERT INTO slide_elements (slide_id, element_type, x, y, width, height, rotation, z_index, locked, hidden, props) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				newSlideID, element.Type, element.X, element.Y, element.Width, element.Height, element.Rotation, element.ZIndex, element.Locked, element.Hidden, element.Props); err != nil {
				return Presentation{}, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return Presentation{}, err
	}
	var cloned Presentation
	if err := db.Get(&cloned, `SELECT id, owner_id, title, status, created_at, updated_at FROM presentations WHERE id=$1`, newPresentationID); err != nil {
		return Presentation{}, err
	}
	return cloned, nil
}
