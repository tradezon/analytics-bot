import type { Database } from 'sqlite';
import { SignalSettings, SignalRepository, User } from './types';

const defaultSettings: SignalSettings = {
  hideSensitiveData: false,
  follows: true
};

export function createSqliteSignalRepository(db: Database): SignalRepository {
  const getSettings: SignalRepository['getSettings'] = async (user) => {
    const row = await db.get(
      'SELECT * from Signal WHERE telegram_id=(?)',
      user.id
    );
    return row
      ? {
          hideSensitiveData: Boolean(row.hide_sensitive_data),
          follows: Boolean(row.follows)
        }
      : defaultSettings;
  };
  const updateSettings: (
    user: User,
    settings: SignalSettings
  ) => Promise<boolean> = async (user, settings) => {
    const has = await db.get(
      'SELECT * from Signal WHERE telegram_id=(?)',
      user.id
    );
    if (has) {
      const row = await db.run(
        'UPDATE Signal SET follows=(?), hide_sensitive_data=(?) WHERE telegram_id=(?)',
        Number(settings.follows),
        Number(settings.hideSensitiveData),
        user.id
      );
      return row.changes !== 0;
    }

    const row = await db.run(
      'INSERT INTO Signal (telegram_id, follows, hide_sensitive_data) VALUES ((?), (?), (?))',
      user.id,
      Number(settings.follows),
      Number(settings.hideSensitiveData)
    );
    return row.changes !== 0;
  };

  return {
    getSettings,
    async toggleFollows(user) {
      const settings = await getSettings(user);
      settings.follows = !settings.follows;
      if (await updateSettings(user, settings)) return settings;
      settings.follows = !settings.follows;
      return settings;
    },
    async toggleHideSensitive(user) {
      const settings = await getSettings(user);
      settings.hideSensitiveData = !settings.hideSensitiveData;
      if (await updateSettings(user, settings)) return settings;
      settings.hideSensitiveData = !settings.hideSensitiveData;
      return settings;
    }
  };
}
