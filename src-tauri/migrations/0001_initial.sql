PRAGMA foreign_keys = ON;

CREATE TABLE projects (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    version INTEGER NOT NULL,
    active_article_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE assets (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
    sha256 TEXT,
    missing_at TEXT,
    UNIQUE (project_id, relative_path)
);

CREATE TABLE videos (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES assets(id),
    thumbnail_asset_id TEXT REFERENCES assets(id),
    title TEXT NOT NULL,
    media_json TEXT NOT NULL CHECK (json_valid(media_json)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE articles (
    id TEXT PRIMARY KEY NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    source_video_id TEXT REFERENCES videos(id),
    title TEXT NOT NULL,
    source_range_json TEXT NOT NULL,
    crop_json TEXT,
    perspective_crop_json TEXT,
    settings_json TEXT NOT NULL,
    workflow_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    CHECK (json_valid(source_range_json)),
    CHECK (crop_json IS NULL OR json_valid(crop_json)),
    CHECK (perspective_crop_json IS NULL OR json_valid(perspective_crop_json)),
    CHECK (json_valid(settings_json)),
    CHECK (json_valid(workflow_json))
);

CREATE TABLE analysis_runs (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN (
        'slide_detection',
        'transcription',
        'ocr',
        'body_generation',
        'summary_generation',
        'chapter_generation'
    )),
    result_json TEXT,
    started_at TEXT NOT NULL,
    CHECK (result_json IS NULL OR json_valid(result_json))
);

CREATE TABLE slides (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
    end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms),
    detection_json TEXT NOT NULL,
    image_asset_id TEXT REFERENCES assets(id),
    transcript_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    UNIQUE (run_id, position),
    CHECK (json_valid(detection_json)),
    CHECK (transcript_json IS NULL OR json_valid(transcript_json))
);

CREATE TABLE ocr_results (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    slide_id TEXT NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    edited_text TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL DEFAULT '',
    CHECK (json_valid(metadata_json))
);

CREATE TABLE documents (
    article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    article_json TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    CHECK (article_json IS NULL OR json_valid(article_json))
);

CREATE TABLE article_material_selections (
    article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    slide_run_id TEXT REFERENCES analysis_runs(id),
    transcription_run_id TEXT REFERENCES analysis_runs(id)
);

CREATE TABLE slide_ocr_selections (
    slide_id TEXT PRIMARY KEY NOT NULL REFERENCES slides(id) ON DELETE CASCADE,
    ocr_result_id TEXT NOT NULL REFERENCES ocr_results(id)
);

CREATE INDEX idx_assets_project ON assets(project_id);
CREATE INDEX idx_videos_project ON videos(project_id);
CREATE INDEX idx_articles_project_created ON articles(project_id, created_at, id);
CREATE INDEX idx_analysis_runs_article_kind ON analysis_runs(article_id, kind, started_at);
CREATE INDEX idx_slides_article_run ON slides(article_id, run_id);
CREATE INDEX idx_ocr_results_slide_created ON ocr_results(slide_id, created_at DESC, id DESC);
