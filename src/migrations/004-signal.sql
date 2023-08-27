--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE Signal (
                    id   INTEGER PRIMARY KEY,
                    telegram_id INTEGER,
                    follows BIT,
                    hide_sensitive_data BIT
);

CREATE INDEX IF NOT EXISTS signal_id ON Signal(telegram_id);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP INDEX signal_id;
DROP TABLE Signal;
