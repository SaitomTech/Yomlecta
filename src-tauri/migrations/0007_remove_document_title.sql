-- Article titles live in articles.title. Keep other document fields and NULL documents.
UPDATE documents
SET article_json = json_remove(article_json, '$.title')
WHERE article_json IS NOT NULL AND json_valid(article_json)
  AND json_type(article_json, '$.title') IS NOT NULL;
