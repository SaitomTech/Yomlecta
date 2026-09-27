CREATE TABLE article_block_segments_new (
    block_id TEXT NOT NULL REFERENCES article_blocks(id) ON DELETE CASCADE,
    segment_id TEXT NOT NULL UNIQUE REFERENCES visual_segments(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (block_id, segment_id)
);

INSERT INTO article_block_segments_new (block_id, segment_id, position)
SELECT block_id, segment_id, position FROM article_block_segments;

DROP TABLE article_block_segments;
ALTER TABLE article_block_segments_new RENAME TO article_block_segments;

CREATE INDEX idx_article_block_segments_block_position
ON article_block_segments(block_id, position);
