import path from 'path';
import fs from 'fs';
import invariant from 'invariant';

export interface Config {
  token: string;
  etherium_mainnet: string;
}

export async function readConfig(configPath: string): Promise<Config> {
  const absolutePath = path.resolve(process.cwd(), configPath);
  const data = await fs.promises.readFile(absolutePath, { encoding: 'utf-8' });
  const obj = JSON.parse(data);
  invariant(obj.token, 'telegram token should be provided');
  invariant(obj.etherium_mainnet, 'etherium node url should be provided');
  return obj as Config;
}
