import type { WebSocketProvider, JsonRpcProvider, Block } from 'ethers';

type Provider = WebSocketProvider | JsonRpcProvider;

async function getBlockTimeStamp(provider: Provider, blockNumber?: number) {
  const block = await provider.getBlock(blockNumber || 'latest', false);
  if (!block)
    throw new Error(
      blockNumber
        ? `Block number ${blockNumber} not found`
        : 'Latest block not found!'
    );
  return block;
}

async function _findBlockByTimestamp(
  provider: Provider,
  timestamp: number,
  blockStart: number,
  blockEnd?: number
): Promise<Block> {
  const [block0, block1] = await Promise.all([
    getBlockTimeStamp(provider, blockStart),
    getBlockTimeStamp(provider, blockEnd)
  ]);
  if (timestamp > block1.timestamp) return block1;
  if (timestamp < block0.timestamp) return block0;
  const t0 = block0.timestamp;
  const t1 = block1.timestamp;
  const i0 = blockStart;
  const i1 = block1.number;
  const averageBlockTime = (t1 - t0) / (i1 - i0);
  const k = (timestamp - t0) / (t1 - t0);
  const expectedMiddleBlockNumber = Math.floor(i0 + k * (i1 - i0));
  const expectedBlock = await getBlockTimeStamp(
    provider,
    expectedMiddleBlockNumber
  );
  const discrepancyInBlocks = Math.floor(
    (timestamp - expectedBlock.timestamp) / averageBlockTime
  );
  const newExpectedMiddle = expectedBlock.number + discrepancyInBlocks;

  const r = Math.abs(discrepancyInBlocks);
  if (r === 0) return expectedBlock;

  return _findBlockByTimestamp(
    provider,
    timestamp,
    newExpectedMiddle - r,
    newExpectedMiddle + r
  );
}

export async function findBlockByTimestamp(
  timestamp: number,
  provider: Provider
) {
  return _findBlockByTimestamp(provider, timestamp, 1);
}
