const escape = (str: string) =>
  str.replaceAll(/(_|\*|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||\{|\}|\.|\!)/g, '\\$1');

export function markdownUserLink(text: string, username: string) {
  return `[${escape(text)}](tg://resolve?domain=${username})`;
}
