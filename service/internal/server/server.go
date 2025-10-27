package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"
)

type Options struct {
	AllowedOrigins, CoreAPIBase string
	DB                          *sqlx.DB
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

func New(opts Options) *fiber.App {
	app := fiber.New()
	// CORS reflect for berjis.tech w/ credentials
	app.Use(func(c *fiber.Ctx) error {
		origin := c.Get("Origin")
		if origin != "" {
			if origin == "https://berjis.tech" || strings.HasSuffix(origin, ".berjis.tech") {
				c.Set("Access-Control-Allow-Origin", origin)
				c.Set("Vary", "Origin")
				c.Set("Access-Control-Allow-Credentials", "true")
				c.Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
				c.Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept")
				if c.Method() == fiber.MethodOptions {
					return c.SendStatus(fiber.StatusNoContent)
				}
			}
		}
		return c.Next()
	})

	app.Get("/v1/health", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"success": true}) })

	getUID := func(c *fiber.Ctx) (string, error) {
		req, _ := http.NewRequest("GET", strings.TrimRight(opts.CoreAPIBase, "/")+"/v1/auth/verify", nil)
		if v := c.Get("Authorization"); v != "" {
			req.Header.Set("Authorization", v)
		}
		if v := c.Get("Cookie"); v != "" {
			req.Header.Set("Cookie", v)
		}
		client := &http.Client{Timeout: 3 * time.Second}
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
		valid, _ := data["valid"].(bool)
		if !valid {
			return "", fiber.ErrUnauthorized
		}
		if uidAny, ok := data["uid"]; ok {
			switch v := uidAny.(type) {
			case float64:
				return fmt.Sprintf("%0.0f", v), nil
			case string:
				return v, nil
			}
		}
		if s, ok := data["userId"].(string); ok && s != "" {
			return s, nil
		}
		return "", fiber.ErrUnauthorized
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
		q := `SELECT id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at FROM slides
              WHERE user_id=$1 AND status = ANY(string_to_array($2, ','))
              ORDER BY updated_at DESC`
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
		if err := opts.DB.Get(&s, `SELECT id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at FROM slides WHERE id=$1 AND user_id=$2`, id, uid); err != nil {
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
            WHERE id=$4 AND user_id=$5
            RETURNING id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at`, optStr(in.Title), defaultJSON(in.Data), optStr(in.Status), id, uid); err != nil {
			return c.Status(404).JSON(fiber.Map{"success": false, "message": err.Error()})
		}
		return c.JSON(fiber.Map{"success": true, "data": s})
	})

	app.Post("/v1/slides/:id/archive", func(c *fiber.Ctx) error { return setStatus(opts, c, "archived") })
	app.Post("/v1/slides/:id/restore", func(c *fiber.Ctx) error { return setStatus(opts, c, "active") })
	app.Delete("/v1/slides/:id", func(c *fiber.Ctx) error { return setStatus(opts, c, "deleted") })

	return app
}

func setStatus(opts Options, c *fiber.Ctx, status string) error {
	if opts.DB == nil {
		return c.Status(500).JSON(fiber.Map{"success": false})
	}
	uid, err := func() (string, error) {
		req, _ := http.NewRequest("GET", strings.TrimRight(opts.CoreAPIBase, "/")+"/v1/auth/verify", nil)
		if v := c.Get("Authorization"); v != "" {
			req.Header.Set("Authorization", v)
		}
		if v := c.Get("Cookie"); v != "" {
			req.Header.Set("Cookie", v)
		}
		client := &http.Client{Timeout: 3 * time.Second}
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
		valid, _ := data["valid"].(bool)
		if !valid {
			return "", fiber.ErrUnauthorized
		}
		if uidAny, ok := data["uid"]; ok {
			switch v := uidAny.(type) {
			case float64:
				return fmt.Sprintf("%0.0f", v), nil
			case string:
				return v, nil
			}
		}
		if s, ok := data["userId"].(string); ok && s != "" {
			return s, nil
		}
		return "", fiber.ErrUnauthorized
	}()
	if err != nil {
		return c.Status(401).JSON(fiber.Map{"success": false})
	}
	id := c.Params("id")
	var s Slide
	if err := opts.DB.Get(&s, `UPDATE slides SET status=$1, updated_at=now() WHERE id=$2 AND user_id=$3
        RETURNING id, user_id, title, COALESCE(data,'null'::jsonb) AS data, status, created_at, updated_at`, status, id, uid); err != nil {
		return c.Status(404).JSON(fiber.Map{"success": false, "message": err.Error()})
	}
	return c.JSON(fiber.Map{"success": true, "data": s})
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
