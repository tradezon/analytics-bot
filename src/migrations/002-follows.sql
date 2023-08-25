--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE Follows (
                    id   INTEGER PRIMARY KEY,
                    telegram_id INTEGER,
                    follows TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS follows_id ON Follows(telegram_id);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX follows_id;
DROP TABLE Follows;
