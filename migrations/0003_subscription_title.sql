-- A source's own feed title is often a tagline ("Matt Levine - Bloomberg Opinion Columnist", "DPG RSS") and every
-- poll rewrites feeds.title from the feed. The reader's chosen name lives on the subscription, where a poll never
-- reaches; NULL means use the feed's title.
ALTER TABLE subscriptions ADD COLUMN title TEXT;
