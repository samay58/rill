-- A newsletter posted from the inbox upgrades its feed entry to the full letter and marks the row with a `letter:`
-- content hash (src/worker/letters.ts). The feed poller re-upserts every item on each poll, which would put the
-- one-line teaser back within 30 minutes. This trigger skips any update that would replace a letter with
-- non-letter content; a later letter post (also `letter:`) still goes through.
CREATE TRIGGER IF NOT EXISTS keep_letter_content
BEFORE UPDATE OF content_text, content_html_sanitized, content_hash ON entries
FOR EACH ROW
WHEN OLD.content_hash LIKE 'letter:%' AND (NEW.content_hash IS NULL OR NEW.content_hash NOT LIKE 'letter:%')
BEGIN
  SELECT RAISE(IGNORE);
END;

-- The same holds for an article the reader fetched in full (`extracted:` hash, db.ts updateEntryExtractedContent):
-- without this the next poll put the teaser back and every open fetched the page again (Nov 16 2026). A letter may
-- replace an extraction; nothing else may.
CREATE TRIGGER IF NOT EXISTS keep_extracted_content
BEFORE UPDATE OF content_text, content_html_sanitized, content_hash ON entries
FOR EACH ROW
WHEN OLD.content_hash LIKE 'extracted:%' AND (NEW.content_hash IS NULL OR (NEW.content_hash NOT LIKE 'extracted:%' AND NEW.content_hash NOT LIKE 'letter:%'))
BEGIN
  SELECT RAISE(IGNORE);
END;
