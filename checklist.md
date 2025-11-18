Here's a comprehensive prompt with checklist to build your Angular & Go slides editor:

---

## **Angular & Go Online Slides Editor - Implementation Prompt**

### **Context**
Build a full-featured online presentation editor (like PowerPoint/Google Slides) with Angular frontend and Go backend. Auth and basic CRUD operations are complete. Need to implement the core editor, presentation mode, and sharing features.

---

## **PHASE 1: Core Slide Editor** - [x]

### **Canvas & Rendering Engine**
- [x] Implement HTML Canvas or SVG-based slide canvas (recommend SVG for easier manipulation)
- [x] Create viewport with zoom controls (25%, 50%, 100%, 150%, 200%)
- [x] Add pan/drag functionality for canvas navigation
- [x] Implement grid/guides system with snap-to-grid
- [x] Create ruler components (horizontal/vertical)
- [x] Add alignment guides (center, edges) that appear when dragging

### **Slide Management**
- [x] Thumbnail sidebar showing all slides
- [x] Add new slide (blank, with title, with title+content)
- [x] Delete slide with confirmation
- [x] Duplicate slide functionality
- [x] Reorder slides via drag-and-drop
- [x] Slide navigation (previous/next buttons, keyboard arrows)
- [x] Slide counter display (e.g., "Slide 3 of 10")

---

## **PHASE 2: Element System** - [ ]

### **Text Elements**
- [x] Click-to-add text boxes
- [x] Rich text editor toolbar (bold, italic, underline, strikethrough)
- [x] Font family selector (10+ common fonts)
- [x] Font size control (8pt - 96pt)
- [x] Text color picker with recent colors
- [x] Text alignment (left, center, right, justify)
- [x] Line height control
- [x] Bullet points and numbered lists
- [x] Text wrapping within text box boundaries

### **Shape Elements**
- [x] Rectangle/Square tool
- [x] Circle/Ellipse tool
- [x] Triangle tool
- [x] Line/Arrow tool
- [x] Fill color picker
- [x] Border color and width controls
- [ ] Border style (solid, dashed, dotted)
- [ ] Corner radius for rectangles
- [ ] Shape opacity control

### **Image Elements**
- [ ] Upload image from computer
- [ ] Image URL insertion
- [ ] Drag-and-drop image upload
- [ ] Crop/resize functionality
- [ ] Image filters (brightness, contrast, saturation)
- [ ] Image rotation
- [ ] Image border options
- [ ] Replace image while maintaining position/size

### **Element Manipulation**
- [ ] Select single element (click)
- [ ] Multi-select (Ctrl+click or drag selection box)
- [ ] Resize handles (8 direction resize)
- [ ] Maintain aspect ratio (Shift+drag)
- [ ] Rotation handle
- [ ] Move elements via drag or arrow keys
- [ ] Copy/Paste elements (Ctrl+C/V)
- [ ] Duplicate element (Ctrl+D)
- [ ] Delete element (Del/Backspace)
- [ ] Undo/Redo stack (Ctrl+Z/Y) - minimum 50 actions

### **Layering & Arrangement**
- [ ] Bring to front
- [ ] Send to back
- [ ] Bring forward one layer
- [ ] Send backward one layer
- [ ] Group elements (Ctrl+G)
- [ ] Ungroup elements (Ctrl+Shift+G)
- [ ] Lock/unlock elements
- [ ] Show/hide elements

### **Alignment Tools**
- [ ] Align left edges
- [ ] Align right edges
- [ ] Align top edges
- [ ] Align bottom edges
- [ ] Align horizontal center
- [ ] Align vertical center
- [ ] Distribute horizontally
- [ ] Distribute vertically

---

## **PHASE 3: Data Model & Backend** - [ ]

### **Go Backend - Data Structures**
```go
type Presentation struct {
    ID          string    `json:"id"`
    Title       string    `json:"title"`
    OwnerID     string    `json:"owner_id"`
    Slides      []Slide   `json:"slides"`
    CreatedAt   time.Time `json:"created_at"`
    UpdatedAt   time.Time `json:"updated_at"`
    SharedWith  []Share   `json:"shared_with"`
}

type Slide struct {
    ID          string    `json:"id"`
    Order       int       `json:"order"`
    Background  string    `json:"background"` // color or image URL
    Elements    []Element `json:"elements"`
}

type Element struct {
    ID          string                 `json:"id"`
    Type        string                 `json:"type"` // text, shape, image
    Position    Position               `json:"position"`
    Size        Size                   `json:"size"`
    Rotation    float64                `json:"rotation"`
    ZIndex      int                    `json:"z_index"`
    Locked      bool                   `json:"locked"`
    Properties  map[string]interface{} `json:"properties"`
}

type Share struct {
    UserID      string    `json:"user_id"`
    Permission  string    `json:"permission"` // view, edit
    SharedAt    time.Time `json:"shared_at"`
}
```

### **API Endpoints**
- [ ] `GET /api/presentations/:id/slides` - Get all slides
- [ ] `POST /api/presentations/:id/slides` - Add new slide
- [ ] `PUT /api/presentations/:id/slides/:slideId` - Update slide
- [ ] `DELETE /api/presentations/:id/slides/:slideId` - Delete slide
- [ ] `PUT /api/presentations/:id/slides/reorder` - Reorder slides
- [ ] `POST /api/presentations/:id/elements` - Add element
- [ ] `PUT /api/presentations/:id/elements/:elementId` - Update element
- [ ] `DELETE /api/presentations/:id/elements/:elementId` - Delete element
- [ ] `POST /api/presentations/:id/duplicate` - Duplicate presentation
- [ ] `POST /api/upload/image` - Upload image (store in S3/local storage)

### **Real-time Collaboration (Optional but Recommended)**
- [ ] WebSocket connection setup (Go: gorilla/websocket)
- [ ] Broadcast element changes to all connected users
- [ ] Show active user cursors with names
- [ ] Lock elements when being edited by another user
- [ ] Presence indicators (who's viewing)
- [ ] Conflict resolution for simultaneous edits

---

## **PHASE 4: Presentation Mode** - [ ]

### **Presenter View**
- [ ] Fullscreen presentation mode
- [ ] Navigation: arrow keys, click, or toolbar
- [ ] Slide transitions (fade, slide, none)
- [ ] Speaker notes panel (visible only to presenter)
- [ ] Timer/clock display
- [ ] Slide preview (current + next slide)
- [ ] Exit presentation mode (ESC key)
- [ ] Laser pointer/cursor spotlight
- [ ] Drawing tools during presentation (pen, highlighter)

### **Viewer Mode (for shared presentations)**
- [ ] Clean, distraction-free viewing
- [ ] Auto-advance slides option (with timer)
- [ ] Loop presentation option
- [ ] Print to PDF functionality
- [ ] Download as PDF

---

## **PHASE 5: Sharing & Permissions** - [ ]

### **Share Dialog**
- [ ] "Share" button in editor header
- [ ] Share via email input
- [ ] Share via unique link
- [ ] Permission selector (View only / Can edit)
- [ ] Copy shareable link button
- [ ] Revoke access functionality
- [ ] List of current collaborators
- [ ] Change permissions for existing shares

### **Backend - Sharing System**
- [ ] `POST /api/presentations/:id/share` - Share with user
- [ ] `GET /api/presentations/shared-with-me` - Get presentations shared with user
- [ ] `DELETE /api/presentations/:id/share/:userId` - Remove access
- [ ] `PUT /api/presentations/:id/share/:userId` - Update permissions
- [ ] `GET /api/presentations/:id/collaborators` - List all collaborators
- [ ] Permission middleware to check edit/view rights
- [ ] Public link generation with token
- [ ] Anonymous viewing for public links

### **Public/Private Settings**
- [ ] Make presentation public (anyone with link can view)
- [ ] Make presentation private (only invited users)
- [ ] Public gallery/template system (optional)

---

## **PHASE 6: Polish & UX** - [ ]

### **Themes & Templates**
- [ ] 5-10 pre-designed themes
- [ ] Apply theme to entire presentation
- [ ] Master slide concept (consistent header/footer)
- [ ] Template gallery on create new

### **Auto-save & Versioning**
- [ ] Auto-save every 30 seconds
- [ ] "Saving..." indicator
- [ ] "All changes saved" confirmation
- [ ] Version history (optional but valuable)
- [ ] Restore from version

### **Keyboard Shortcuts**
- [ ] Ctrl+S: Save
- [ ] Ctrl+Z/Y: Undo/Redo
- [ ] Ctrl+C/V/X: Copy/Paste/Cut
- [ ] Ctrl+D: Duplicate
- [ ] Delete: Remove element
- [ ] Ctrl+A: Select all
- [ ] F5: Start presentation
- [ ] ESC: Exit presentation
- [ ] Keyboard shortcuts help panel (?)

### **Export Options**
- [ ] Export as PDF
- [ ] Export as PNG/JPG (individual slides)
- [ ] Export as HTML presentation
- [ ] Print functionality

### **Comments & Feedback (Optional)**
- [ ] Add comments to slides
- [ ] Reply to comments
- [ ] Resolve/mark done
- [ ] Comment notifications

---

## **PHASE 7: Performance & Optimization** - [ ]

### **Frontend**
- [ ] Lazy load slides (virtual scrolling for thumbnails)
- [ ] Debounce auto-save calls
- [ ] Optimize canvas/SVG rendering
- [ ] Image compression before upload
- [ ] Implement service worker for offline editing
- [ ] Use CDN for static assets

### **Backend**
- [ ] Database indexing (user_id, presentation_id)
- [ ] Caching layer (Redis) for frequently accessed presentations
- [ ] Rate limiting on API endpoints
- [ ] Pagination for large presentations
- [ ] Image storage optimization (thumbnails, compression)
- [ ] Database connection pooling

---

## **Technology Stack Recommendations**

### **Angular Frontend**
```typescript
// Key libraries to consider
- @angular/cdk (drag-drop, overlay)
- fabric.js or Konva.js (canvas manipulation)
- ngx-color (color picker)
- quill or tiptap (rich text editor)
- html2canvas (for thumbnails/export)
- jspdf (PDF export)
```

### **Go Backend**
```go
// Key packages
- github.com/gin-gonic/gin (web framework)
- github.com/gorilla/websocket (real-time)
- gorm.io/gorm (ORM)
- github.com/golang-jwt/jwt (auth)
- github.com/aws/aws-sdk-go (S3 storage)
- github.com/disintegration/imaging (image processing)
```

---

## **Suggested Implementation Order**

1. **Week 1-2**: Phase 1 + Phase 2 (basic elements)
2. **Week 3**: Phase 3 (backend data model)
3. **Week 4**: Phase 2 (complete element system)
4. **Week 5**: Phase 4 (presentation mode)
5. **Week 6**: Phase 5 (sharing)
6. **Week 7**: Phase 6 (polish)
7. **Week 8**: Phase 7 (optimization) + testing

---

## **Critical Decisions to Make**

1. **Canvas vs SVG**: SVG recommended for easier DOM manipulation and element selection
2. **Real-time collaboration**: Will significantly increase complexity but is a killer feature
3. **Storage**: Local files vs S3/Cloud Storage for images
4. **Database**: PostgreSQL recommended for relational data + JSONB for slide content
5. **Offline support**: Service Workers for offline editing?

---

## **Security Checklist** - [ ]
- [ ] Validate all user uploads (file type, size)
- [ ] Sanitize HTML content in text elements
- [ ] Rate limit API calls
- [ ] Verify permissions on every API call
- [ ] Use prepared statements for database queries
- [ ] CORS configuration
- [ ] HTTPS only in production
- [ ] XSS protection for shared presentations

---

Good luck with your build! Start with the core editor functionality and iterate from there. The most critical pieces are the element manipulation system and presentation mode—everything else can be added incrementally.
