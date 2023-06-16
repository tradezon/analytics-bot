export const escape = (str: any) =>
  str
    .toString()
    .replaceAll(/(_|\*|\[|\]|\(|\)|~|`|>|#|\+|-|=|\||\{|\}|\.|\!)/g, '\\$1');

export function markdownUserLink(text: string, username: string) {
  return `[${escape(text)}](tg://resolve?domain=${username})`;
}
