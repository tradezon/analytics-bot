export enum Lang {
  EN = 0,
  RU = 1
}

export enum Tier {
  GOD_MODE = 0,
  TIER0 = 5
}

export interface User {
  id: number;
  telegram_username: string;
  lang: Lang;
  tier: Tier;
  last_access: number;
}

export interface Follows {
  telegram_username: string;
  follows: Set<string>;
}

export interface UserRepository {
  deleteUser(id: string): Promise<boolean>;
  addUser(user: string, lang: Lang, tier: Tier): Promise<boolean>;
  updateUser(
    user: string,
    lang: Lang,
    tier: Tier,
    lastAccess?: number
  ): Promise<boolean>;
  getUser(user: string): Promise<User | null>;
  getUsers(): Promise<User[]>;
}

export interface FollowsRepository {
  getUserFollows(user: User): Promise<Follows>;
  toggleFollow(user: User, address: string): Promise<boolean>;
  updateUserFollows(user: User, follows: Follows): Promise<boolean>;
}
