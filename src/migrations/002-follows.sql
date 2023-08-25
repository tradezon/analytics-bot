--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE Follows (
                    id   INTEGER PRIMARY KEY,
                    telegram_username INTEGER,
                    follows TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS follows_username ON Follows(telegram_username);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX follows_username;
DROP TABLE Follows;
