import type { Database } from 'sqlite';
import { Follows, FollowsRepository, User } from './types';

function dataToString(arr: string[]) {
  return arr.join(';');
}

function stringToData(str: string) {
  return str.split(';');
}

export function createSqliteFollowsRepository(db: Database): FollowsRepository {
  const cache = new Map<number, Follows>();
  const getUserFollows = async (user: User): Promise<Follows> => {
    if (cache.has(user.id)) {
      return cache.get(user.id)!;
    }
    const row = await db.get(
      'SELECT * from Follows WHERE telegram_id=(?)',
      user.id
    );
    return {
      telegram_username: user.telegram_username,
      follows: row ? new Set(stringToData(row.follows)) : new Set<string>()
    };
  };
  const updateUserFollows = async (
    user: User,
    follows: Follows
  ): Promise<boolean> => {
    if (follows.follows.size === 0) {
      const row = await db.run(
        'DELETE FROM Follows WHERE telegram_id=(?)',
        user.id
      );
      const updated = row.changes !== 0;
      if (updated) cache.set(user.id, follows);
      return updated;
    }
    if (follows.follows.size === 1) {
      const row = await db.get(
        'SELECT (telegram_id) from Follows WHERE telegram_id=(?)',
        user.id
      );
      if (!row || typeof row.telegram_id !== 'number') {
        const row = await db.run(
          'INSERT INTO Follows (telegram_id, follows) VALUES ((?), (?))',
          user.id,
          dataToString(Array.from(follows.follows))
        );
        const updated = row.changes !== 0;
        if (updated) cache.set(user.id, follows);
        return updated;
      }
    }

    const row = await db.run(
      'UPDATE Follows SET follows=(?) WHERE telegram_id=(?)',
      dataToString(Array.from(follows.follows)),
      user.id
    );
    const updated = row.changes !== 0;
    if (updated) cache.set(user.id, follows);
    return updated;
  };
  return {
    getUserFollows,
    async toggleFollow(user: User, address: string): Promise<boolean> {
      const lowerCase = address.toLowerCase();
      const follows = await getUserFollows(user);
      const had = follows.follows.delete(lowerCase);
      if (!had) follows.follows.add(lowerCase);
      return updateUserFollows(user, follows);
    },
    updateUserFollows
  };
}
