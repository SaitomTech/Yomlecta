CREATE TABLE analysis_runs_new (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN (
        'slide_detection',
        'visual_segmentation',
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

INSERT INTO analysis_runs_new (id, article_id, kind, result_json, started_at)
SELECT id, article_id, kind, result_json, started_at FROM analysis_runs;

CREATE TABLE visual_segments (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL REFERENCES analysis_runs_new(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    start_ms INTEGER NOT NULL CHECK (start_ms >= 0),
    end_ms INTEGER NOT NULL CHECK (end_ms >= start_ms),
    auto_kind TEXT NOT NULL CHECK (auto_kind IN ('slide', 'non-slide', 'unknown')),
    override_kind TEXT CHECK (override_kind IN ('slide', 'non-slide', 'unknown')),
    override_updated_at TEXT,
    person_layout TEXT NOT NULL CHECK (
        person_layout IN ('none', 'inside-crop', 'outside-crop', 'both', 'dominant')
    ),
    detection_json TEXT NOT NULL CHECK (json_valid(detection_json)),
    classification_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(classification_json)),
    representative_asset_id TEXT REFERENCES assets(id),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    UNIQUE (run_id, position)
);

INSERT INTO visual_segments (
    id, article_id, run_id, position, start_ms, end_ms, auto_kind,
    person_layout, detection_json, representative_asset_id, revision
)
SELECT id, article_id, run_id, position, start_ms, end_ms, 'slide',
       'none', detection_json, image_asset_id, revision
FROM slides;

CREATE TABLE article_blocks (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    image_segment_id TEXT REFERENCES visual_segments(id) ON DELETE SET NULL,
    transcript_json TEXT CHECK (transcript_json IS NULL OR json_valid(transcript_json)),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    UNIQUE (article_id, position)
);

INSERT INTO article_blocks (
    id, article_id, position, image_segment_id, transcript_json, revision
)
SELECT id, article_id, position, id, transcript_json, revision FROM slides;

CREATE TABLE article_block_segments (
    block_id TEXT NOT NULL REFERENCES article_blocks(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL UNIQUE REFERENCES visual_segments(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    assignment_source TEXT NOT NULL CHECK (assignment_source IN ('auto', 'manual')),
    PRIMARY KEY (block_id, segment_id)
);

INSERT INTO article_block_segments (block_id, segment_id, position, assignment_source)
SELECT id, id, 0, 'auto' FROM slides;

CREATE TABLE ocr_results_new (
    id TEXT PRIMARY KEY NOT NULL,
    article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL REFERENCES visual_segments(id) ON DELETE CASCADE,
    raw_text TEXT NOT NULL,
    edited_text TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TEXT NOT NULL DEFAULT '',
    CHECK (json_valid(metadata_json))
);

INSERT INTO ocr_results_new (
    id, article_id, segment_id, raw_text, edited_text, metadata_json, revision, created_at
)
SELECT id, article_id, slide_id, raw_text, edited_text, metadata_json, revision, created_at
FROM ocr_results;

CREATE TABLE visual_segment_ocr_selections (
    segment_id TEXT PRIMARY KEY NOT NULL REFERENCES visual_segments(id) ON DELETE CASCADE,
    ocr_result_id TEXT NOT NULL REFERENCES ocr_results_new(id)
);

INSERT INTO visual_segment_ocr_selections (segment_id, ocr_result_id)
SELECT slide_id, ocr_result_id FROM slide_ocr_selections;

CREATE TABLE article_material_selections_new (
    article_id TEXT PRIMARY KEY NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
    visual_run_id TEXT REFERENCES analysis_runs_new(id),
    transcription_run_id TEXT REFERENCES analysis_runs_new(id)
);

INSERT INTO article_material_selections_new (article_id, visual_run_id, transcription_run_id)
SELECT article_id, slide_run_id, transcription_run_id FROM article_material_selections;

DROP TABLE slide_ocr_selections;
DROP TABLE ocr_results;
DROP TABLE article_material_selections;
DROP TABLE slides;
DROP TABLE analysis_runs;

ALTER TABLE analysis_runs_new RENAME TO analysis_runs;
ALTER TABLE ocr_results_new RENAME TO ocr_results;
ALTER TABLE article_material_selections_new RENAME TO article_material_selections;

CREATE INDEX idx_analysis_runs_article_kind ON analysis_runs(article_id, kind, started_at);
CREATE INDEX idx_visual_segments_article_run ON visual_segments(article_id, run_id, position);
CREATE INDEX idx_article_blocks_article_position ON article_blocks(article_id, position);
CREATE INDEX idx_article_block_segments_block_position ON article_block_segments(block_id, position);
CREATE INDEX idx_ocr_results_segment_created ON ocr_results(segment_id, created_at DESC, id DESC);
