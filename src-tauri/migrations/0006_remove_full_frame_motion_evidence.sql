UPDATE visual_segments
SET classification_json = json_remove(
    classification_json,
    '$.evidence.fullFrameMotionMedian'
)
WHERE json_type(classification_json, '$.evidence.fullFrameMotionMedian') IS NOT NULL;
