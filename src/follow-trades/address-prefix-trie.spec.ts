import { createPrefixTrie } from './address-prefix-trie';

const test1 = '0xB8Bd911aA8fa479758275Bab75d4E0eb91Ed7408';
const test2 = test1.toLowerCase();
const test3 = '0xB8Bd911aA8fa479758275Bab75d4E0eb91Ed1111';
const wrong = new Array(test1.length).fill('0').join('');

it('should successfully add', () => {
  const trie = createPrefixTrie();
  trie.add(test1, 1);
  expect(trie.get(test1)).toContain(1);
  expect(trie.get(wrong)).toHaveLength(0);
});

it('should successfully delete #1', () => {
  const trie = createPrefixTrie();
  trie.add(test1, 1);
  expect(trie.get(test1)).toContain(1);
  trie.remove(test1, 1);
  expect(trie.get(test1)).toHaveLength(0);
});

it('should successfully delete #2', () => {
  const trie = createPrefixTrie();
  trie.add(test1, 1);
  expect(trie.get(test1)).toContain(1);
  trie.remove(test1, 2);
  expect(trie.get(test1)).toHaveLength(1);
});

it('should successfully delete #3', () => {
  const trie = createPrefixTrie();
  trie.add(test1, 1);
  trie.add(test1, 2);
  expect(trie.get(test1)).toContain(1);
  expect(trie.get(test1)).toContain(2);
  trie.remove(test1, 2);
  expect(trie.get(test1)).toContain(1);
  expect(trie.get(test1)).not.toContain(2);
});

it('should be case insensitive', () => {
  const trie = createPrefixTrie();
  trie.add(test1, 1);
  expect(trie.get(test2)).toContain(1);
});

it('complex #1', () => {
  const trie = createPrefixTrie();
  trie.add(test1, 1);
  // should prevent duplication
  trie.add(test2, 1);
  trie.add(test3, 2);
  expect(trie.get(test2)).toContain(1);
  expect(trie.get(test2)).toHaveLength(1);
  expect(trie.get(test3)).toContain(2);
  trie.remove(test3, 2);
  expect(trie.get(test2)).toContain(1);
  expect(trie.get(test3)).toHaveLength(0);
});
