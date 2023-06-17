import { LRUCache } from 'lru-cache';
import { Report } from '../types';

const cache = new LRUCache<string, Report>({
  max: 200,
  ttl: 24 * 60 * 60 * 1000, // 1 day,
  ttlAutopurge: false,
  allowStale: false,
  updateAgeOnGet: true,
  updateAgeOnHas: false
});

export default cache;
