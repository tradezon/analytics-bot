import type { Database } from 'sqlite';
import type { User, Lang, Tier, UserRepository } from './types';

export function createSqliteUserRepository(db: Database): UserRepository {
  return {
    async addUser(user: string, lang: Lang, tier: Tier): Promise<boolean> {
      const row = await db.run(
        'INSERT INTO User (telegram_username, lang, tier, last_access, chat_id) VALUES ((?), (?), (?), 0, 0)',
        user.startsWith('@') ? user.slice(1) : user,
        lang,
        tier
      );
      return row.changes !== 0;
    },
    async updateUser(
      user: string,
      lang: Lang,
      tier: Tier,
      lastAccess = 0,
      chat_id
    ) {
      let row: any;
      if (chat_id) {
        row = await db.run(
          'UPDATE User SET lang=(?), last_access=(?), tier=(?), chat_id=(?) WHERE telegram_username LIKE (?)',
          lang,
          lastAccess,
          tier,
          chat_id,
          user.startsWith('@') ? user.slice(1) : user
        );
      } else {
        row = await db.run(
          'UPDATE User SET lang=(?), last_access=(?), tier=(?) WHERE telegram_username LIKE (?)',
          lang,
          lastAccess,
          tier,
          user.startsWith('@') ? user.slice(1) : user
        );
      }
      return row.changes !== 0;
    },
    async deleteUser(id: string): Promise<boolean> {
      const row = await db.run(
        'DELETE FROM User WHERE telegram_username LIKE (?)',
        id
      );
      return row.changes !== 0;
    },
    async getUser(user: string): Promise<User | null> {
      const row = await db.get(
        'SELECT * from User WHERE telegram_username LIKE (?)',
        user.startsWith('@') ? user.slice(1) : user
      );
      return row || null;
    },
    async getUserById(id: number): Promise<User | null> {
      const row = await db.get('SELECT * from User WHERE id=(?)', id);
      return row || null;
    },
    getUsers(): Promise<User[]> {
      return db.all('SELECT * from User');
    }
  };
}
