--------------------------------------------------------------------------------
-- Up
--------------------------------------------------------------------------------

CREATE TABLE User (
                    id   INTEGER PRIMARY KEY,
                    telegram_username TEXT NOT NULL,
                    lang INTEGER NOT NULL,
                    tier INTEGER NOT NULL,
                    last_access INTEGER NOT NULL
);

INSERT INTO User (id, telegram_username, lang, tier, last_access) VALUES (1, 'ivankopeykin', 0, 0, 0);

--------------------------------------------------------------------------------
-- Down
--------------------------------------------------------------------------------

DROP TABLE User;
