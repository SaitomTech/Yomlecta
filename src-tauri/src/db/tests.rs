use super::assets::inspect_asset;
use super::repositories::{load_project_from_indexes, load_project_summary};
use super::services::documents::{update_article_title, update_article_workflow};
use super::services::projects::create_project_bundle;
use super::DbState;
use serde_json::json;
use sqlx::sqlite::SqlitePoolOptions;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn normalized_indexes_round_trip_a_project() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply migrations");
        let project = json!({
            "version": 11,
            "id": "project-1",
            "title": "Test project",
            "videos": [{
                "id": "video-1",
                "title": "lecture.mp4",
                "media": {
                    "path": "/tmp/lecture.mp4",
                    "name": "lecture.mp4",
                    "extension": "mp4",
                    "sizeBytes": 1,
                    "metadata": {"path": "/tmp/lecture.mp4", "durationMs": 1000, "width": 1280, "height": 720},
                    "origin": {"kind": "local-file"},
                    "ownership": "managed",
                    "managedRelativePath": "videos/video-1/original.mp4"
                },
                "createdAt": "2026-09-19T00:00:00.000Z",
                "updatedAt": "2026-09-19T00:00:00.000Z"
            }],
            "articles": [{
                "id": "article-1",
                "title": "Notes",
                "sourceVideoId": "video-1",
                "inputMedia": {
                    "path": "/tmp/lecture.mp4",
                    "name": "lecture.mp4",
                    "extension": "mp4",
                    "metadata": {"path": "/tmp/lecture.mp4", "durationMs": 1000, "width": 1280, "height": 720},
                    "origin": {"kind": "local-file"},
                    "ownership": "managed",
                    "managedRelativePath": "videos/video-1/original.mp4",
                    "preparedFromVideoId": "video-1",
                    "preparation": "reference",
                    "preparedAt": "2026-09-19T00:00:00.000Z"
                },
                "sourceRange": {"startMs": 0, "endMs": 1000},
                "crop": {"x": 0, "y": 0, "width": 1280, "height": 720},
                "settings": {"slideDetection": {"sampleIntervalMs": 500, "threshold": 12}, "transcription": true, "ocr": true, "correction": true, "articleFormatting": true},
                "slides": [{
                    "id": "slide-1",
                    "index": 0,
                    "startMs": 0,
                    "endMs": 1000,
                    "detection": {"source": "auto", "hash": "abc"},
                    "image": {"representativeFramePath": "/tmp/slide.jpg"},
                    "ocr": {"rawText": "OCR", "model": "vision"},
                    "transcript": {"raw": "hello", "articleBody": "本文", "model": "whisper"}
                }],
                "slideDetection": {"sampleIntervalMs": 500, "threshold": 12, "framesAnalyzed": 2, "boundaries": [], "detectedAt": "2026-09-19T00:00:00.000Z"},
                "transcription": {"model": "whisper", "audioPath": "/tmp/audio.wav", "segments": [{"id": "segment-1", "startMs": 0, "endMs": 1000, "text": "hello"}], "transcribedAt": "2026-09-19T00:00:00.000Z", "inputFingerprint": "fp"},
                "article": {"title": "Notes", "summary": {"overview": "概要", "mainMessage": "主題", "keyPoints": ["要点"], "keywords": ["key"], "model": "llm", "inputFingerprint": "fp"}, "sections": {"sections": [{"id": "section-1", "heading": "見出し", "slideIds": ["slide-1"]}], "model": "llm", "inputFingerprint": "fp"}},
                "workflow": {"lastVisitedStep": "article-review", "maxReachedStep": "article-review", "lastOpenedAt": "2026-09-19T00:00:00.000Z"},
                "createdAt": "2026-09-19T00:00:00.000Z",
                "updatedAt": "2026-09-19T00:00:00.000Z"
            }],
            "activeArticleId": "article-1",
            "createdAt": "2026-09-19T00:00:00.000Z",
            "updatedAt": "2026-09-19T00:00:00.000Z"
        });
        let root =
            std::env::temp_dir().join(format!("yomlecta-bundle-test-{}", std::process::id()));
        fs::create_dir_all(&root).expect("create app data directory");
        let state = DbState {
            pool: pool.clone(),
            app_data_dir: root.clone(),
        };
        create_project_bundle(
            &state,
            project.clone(),
            project["videos"][0].clone(),
            project["articles"][0].clone(),
        )
        .await
        .expect("create project bundle through production service");
        let loaded = load_project_from_indexes(&pool, "project-1")
            .await
            .expect("load normalized project");
        assert_eq!(loaded["articles"][0]["title"], "Notes");
        assert_eq!(loaded["videos"][0]["media"]["path"], "/tmp/lecture.mp4");
        let summary = load_project_summary(&pool, "project-1")
            .await
            .expect("load project summary");
        assert_eq!(summary["kind"], "project");
        assert_eq!(summary["summary"]["slideCount"], 0);
        assert_eq!(summary["summary"]["ocrCompleted"], 0);
        assert_eq!(summary["summary"]["articleCompleted"], 0);
        fs::remove_dir_all(root).expect("cleanup app data directory");
    });
}

#[test]
fn asset_metadata_tracks_size_and_missing_state() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let root = std::env::temp_dir().join(format!("yomlecta-asset-test-{suffix}"));
    fs::create_dir_all(root.join("projects/p")).expect("create asset root");
    fs::write(root.join("projects/p/hello.txt"), b"hello").expect("write asset");
    let metadata = inspect_asset(&root, "p", "hello.txt").expect("inspect asset");
    assert_eq!(metadata.byte_size, 5);
    assert!(metadata.missing_at.is_none());
    let missing = inspect_asset(&root, "p", "missing.txt").expect("inspect missing asset");
    assert_eq!(missing.byte_size, 0);
    assert!(missing.missing_at.is_some());
    fs::remove_dir_all(root).expect("cleanup asset root");
}

#[test]
fn revision_condition_prevents_stale_update() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply migrations");
        sqlx::query(
            "INSERT INTO projects (id, title, version, created_at, updated_at) VALUES ('p', 'p', 1, 'x', 'x')",
        )
        .execute(&pool)
        .await
        .expect("insert project");
        sqlx::query(
            "INSERT INTO articles (id, project_id, title, source_range_json, settings_json, workflow_json, created_at, updated_at)
             VALUES ('a', 'p', 'a', '{}', '{}', '{}', 'x', 'x')",
        )
        .execute(&pool)
        .await
        .expect("insert article");
        let first = sqlx::query(
            "UPDATE articles SET title = 'first', revision = revision + 1 WHERE id = 'a' AND revision = 0",
        )
        .execute(&pool)
        .await
        .expect("first update");
        let stale = sqlx::query(
            "UPDATE articles SET title = 'stale', revision = revision + 1 WHERE id = 'a' AND revision = 0",
        )
        .execute(&pool)
        .await
        .expect("stale update");
        assert_eq!(first.rows_affected(), 1);
        assert_eq!(stale.rows_affected(), 0);
        let title: String = sqlx::query_scalar("SELECT title FROM articles WHERE id = 'a'")
            .fetch_one(&pool)
            .await
            .expect("read article");
        assert_eq!(title, "first");
    });
}

#[test]
fn article_title_service_updates_article_and_document_atomically() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply migrations");
        sqlx::query(
            "INSERT INTO projects (id, title, version, created_at, updated_at, revision)
             VALUES ('p', 'Project', 1, 'created', 'updated', 0)",
        )
        .execute(&pool)
        .await
        .expect("insert project");
        sqlx::query(
            "INSERT INTO articles (id, project_id, title, source_range_json, settings_json, workflow_json, created_at, updated_at, revision)
             VALUES ('a', 'p', 'Old title', '{}', '{}', '{}', 'created', 'updated', 0)",
        )
        .execute(&pool)
        .await
        .expect("insert article");
        sqlx::query(
            "INSERT INTO documents (article_id, article_json, revision)
             VALUES ('a', json('{\"title\":\"Old title\",\"summary\":{\"overview\":\"keep\"}}'), 0)",
        )
        .execute(&pool)
        .await
        .expect("insert document");

        let root =
            std::env::temp_dir().join(format!("yomlecta-service-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("create app data directory");
        let state = DbState {
            pool: pool.clone(),
            app_data_dir: root.clone(),
        };
        let result = update_article_title(
            &state,
            "p".to_string(),
            "a".to_string(),
            "New title".to_string(),
            "saved".to_string(),
            Some(0),
            Some(0),
            Some(0),
        )
        .await
        .expect("update title through production service");
        assert_eq!(result["projectRevision"], 1);
        assert_eq!(result["articleRevision"], 1);
        assert_eq!(result["documentRevision"], 1);

        let article_title: String = sqlx::query_scalar("SELECT title FROM articles WHERE id = 'a'")
            .fetch_one(&pool)
            .await
            .expect("read article title");
        assert_eq!(article_title, "New title");
        let document_json: String =
            sqlx::query_scalar("SELECT article_json FROM documents WHERE article_id = 'a'")
                .fetch_one(&pool)
                .await
                .expect("read document");
        let document: serde_json::Value =
            serde_json::from_str(&document_json).expect("parse document");
        assert_eq!(document["title"], "New title");
        assert_eq!(document["summary"]["overview"], "keep");

        let workflow_result = update_article_workflow(
            &state,
            "p".to_string(),
            "a".to_string(),
            Some("a".to_string()),
            json!({ "lastVisitedStep": "export", "maxReachedStep": "export" }),
            "workflow".to_string(),
            Some(1),
            Some(1),
        )
        .await
        .expect("update workflow through production service");
        assert_eq!(workflow_result["projectRevision"], 2);
        assert_eq!(workflow_result["articleRevision"], 2);
        let workflow_json: String =
            sqlx::query_scalar("SELECT workflow_json FROM articles WHERE id = 'a'")
                .fetch_one(&pool)
                .await
                .expect("read workflow");
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&workflow_json).expect("parse workflow"),
            json!({ "lastVisitedStep": "export", "maxReachedStep": "export" })
        );
        let active_article: String =
            sqlx::query_scalar("SELECT active_article_id FROM projects WHERE id = 'p'")
                .fetch_one(&pool)
                .await
                .expect("read active article");
        assert_eq!(active_article, "a");

        sqlx::query(
            "CREATE TRIGGER fail_title_project BEFORE UPDATE OF updated_at ON projects
             WHEN NEW.id = 'p' BEGIN SELECT RAISE(ABORT, 'forced rollback'); END",
        )
        .execute(&pool)
        .await
        .expect("create rollback trigger");
        let rollback = update_article_title(
            &state,
            "p".to_string(),
            "a".to_string(),
            "Should roll back".to_string(),
            "rollback".to_string(),
            Some(2),
            Some(2),
            Some(1),
        )
        .await
        .expect_err("project failure must roll back the title update");
        assert!(rollback.contains("プロジェクト更新時刻を更新できませんでした"));
        sqlx::query("DROP TRIGGER fail_title_project")
            .execute(&pool)
            .await
            .expect("drop rollback trigger");
        let title_after_rollback: String =
            sqlx::query_scalar("SELECT title FROM articles WHERE id = 'a'")
                .fetch_one(&pool)
                .await
                .expect("read title after rollback");
        assert_eq!(title_after_rollback, "New title");

        let stale = update_article_title(
            &state,
            "p".to_string(),
            "a".to_string(),
            "Stale title".to_string(),
            "stale".to_string(),
            Some(0),
            Some(0),
            Some(0),
        )
        .await
        .expect_err("stale title update must be rejected");
        assert!(stale.starts_with("REVISION_CONFLICT:"));
        let title_after_stale: String =
            sqlx::query_scalar("SELECT title FROM articles WHERE id = 'a'")
                .fetch_one(&pool)
                .await
                .expect("read title after stale update");
        assert_eq!(title_after_stale, "New title");
        std::fs::remove_dir_all(root).expect("cleanup app data directory");
    });
}

#[test]
fn project_summary_uses_the_same_effective_ocr_as_project_load() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply migrations");

        sqlx::query(
            "INSERT INTO projects (id, title, version, active_article_id, created_at, updated_at, revision)
             VALUES ('p', 'Project', 1, 'a', 'created', 'updated', 0)",
        )
        .execute(&pool)
        .await
        .expect("insert project");
        sqlx::query(
            "INSERT INTO assets (id, project_id, relative_path, byte_size)
             VALUES ('video-asset', 'p', 'videos/v/original.mp4', 1),
                    ('image-1', 'p', 'articles/a/slides/1.jpg', 1),
                    ('image-2', 'p', 'articles/a/slides/2.jpg', 1),
                    ('image-3', 'p', 'articles/a/slides/3.jpg', 1),
                    ('image-4', 'p', 'articles/a/slides/4.jpg', 1)",
        )
        .execute(&pool)
        .await
        .expect("insert assets");
        sqlx::query(
            "INSERT INTO videos (id, project_id, asset_id, title, media_json, created_at, updated_at)
             VALUES ('v', 'p', 'video-asset', 'video.mp4', ?, 'created', 'updated')",
        )
        .bind(serde_json::to_string(&json!({
            "path": "/tmp/video.mp4",
            "name": "video.mp4",
            "extension": "mp4",
            "metadata": {"durationMs": 1000, "width": 1920, "height": 1080},
            "origin": {"kind": "local-file"},
            "ownership": "managed",
            "managedRelativePath": "videos/v/original.mp4"
        })).expect("serialize media"))
        .execute(&pool)
        .await
        .expect("insert video");
        sqlx::query(
            "INSERT INTO articles (id, project_id, source_video_id, title, source_range_json,
             crop_json, settings_json, workflow_json, created_at, updated_at, revision)
             VALUES ('a', 'p', 'v', 'Article', ?, ?, '{}', ?, 'created', 'updated', 0)",
        )
        .bind(
            serde_json::to_string(&json!({"startMs": 0, "endMs": 1000})).expect("serialize range"),
        )
        .bind(
            serde_json::to_string(&json!({"x": 0, "y": 0, "width": 1920, "height": 1080}))
                .expect("serialize crop"),
        )
        .bind(
            serde_json::to_string(&json!({"lastVisitedStep": "crop", "lastOpenedAt": "opened"}))
                .expect("serialize workflow"),
        )
        .execute(&pool)
        .await
        .expect("insert article");
        sqlx::query("INSERT INTO documents (article_id, article_json) VALUES ('a', NULL)")
            .execute(&pool)
            .await
            .expect("insert document");
        sqlx::query(
            "INSERT INTO analysis_runs (id, article_id, kind, result_json, started_at)
             VALUES ('detection', 'a', 'slide_detection', ?, 'created')",
        )
        .bind(
            serde_json::to_string(&json!({"sampleIntervalMs": 500, "threshold": 1}))
                .expect("serialize detection"),
        )
        .execute(&pool)
        .await
        .expect("insert detection run");
        sqlx::query(
            "INSERT INTO article_material_selections (article_id, slide_run_id)
             VALUES ('a', 'detection')",
        )
        .execute(&pool)
        .await
        .expect("select detection run");

        let transcripts = [
            json!({"raw": "\u{3000}\t", "articleBody": "\u{200B}"}),
            json!({"raw": "speech", "articleBody": "\u{2003}"}),
            json!({"raw": "speech", "articleBody": "body"}),
            json!({}),
        ];
        for (index, transcript) in transcripts.iter().enumerate() {
            sqlx::query(
                "INSERT INTO slides (id, article_id, run_id, position, start_ms, end_ms,
                 detection_json, image_asset_id, transcript_json)
                 VALUES (?, 'a', 'detection', ?, ?, ?, '{}', ?, ?)",
            )
            .bind(format!("s{}", index + 1))
            .bind(index as i64)
            .bind((index * 250) as i64)
            .bind(((index + 1) * 250) as i64)
            .bind(format!("image-{}", index + 1))
            .bind(serde_json::to_string(transcript).expect("serialize transcript"))
            .execute(&pool)
            .await
            .expect("insert slide");
        }

        let ocr_rows = [
            ("ocr-1", "s1", "before", Some(""), "before", "2026-01-01"),
            (
                "ocr-2",
                "s2",
                "\u{3000}\t",
                Some("\u{2003}"),
                "stale",
                "2026-01-01",
            ),
            ("ocr-3", "s3", "raw", Some("edited"), "stale", "2026-01-01"),
            ("ocr-4-old", "s4", "old", None, "old", "2026-01-01"),
            ("ocr-4-new", "s4", "latest", None, "latest", "2026-01-02"),
        ];
        for (id, slide_id, raw_text, edited_text, metadata_text, created_at) in ocr_rows {
            sqlx::query(
                "INSERT INTO ocr_results (id, article_id, slide_id, raw_text, edited_text, metadata_json, created_at)
                 VALUES (?, 'a', ?, ?, ?, ?, ?)",
            )
            .bind(id)
            .bind(slide_id)
            .bind(raw_text)
            .bind(edited_text)
            .bind(serde_json::to_string(&json!({"rawText": metadata_text})).expect("serialize OCR metadata"))
            .bind(created_at)
            .execute(&pool)
            .await
            .expect("insert OCR result");
        }
        for (slide_id, ocr_id) in [("s1", "ocr-1"), ("s2", "ocr-2"), ("s3", "ocr-3")] {
            sqlx::query("INSERT INTO slide_ocr_selections (slide_id, ocr_result_id) VALUES (?, ?)")
                .bind(slide_id)
                .bind(ocr_id)
                .execute(&pool)
                .await
                .expect("select OCR result");
        }

        let summary = load_project_summary(&pool, "p")
            .await
            .expect("load project summary");
        assert_eq!(summary["summary"]["slideCount"], 4);
        assert_eq!(summary["summary"]["ocrCompleted"], 2);
        assert_eq!(summary["summary"]["articleTarget"], 2);
        assert_eq!(summary["summary"]["articleCompleted"], 2);
        assert_eq!(summary["summary"]["resumeStep"], "crop");

        let loaded = load_project_from_indexes(&pool, "p")
            .await
            .expect("load project");
        assert_eq!(loaded["articles"][0]["slides"][0]["ocr"]["rawText"], "");
        assert_eq!(loaded["articles"][0]["slides"][1]["ocr"]["rawText"], " ");
        assert_eq!(
            loaded["articles"][0]["slides"][2]["ocr"]["rawText"],
            "edited"
        );
        assert_eq!(
            loaded["articles"][0]["slides"][3]["ocr"]["rawText"],
            "latest"
        );
    });
}
