import DexGuru, { ChainsListModel } from 'dexguru-sdk';
import {
  AmmChoices,
  api_public__models_api__rest_swaps_burns_mints__RestSwapBurnMintModel__SortFields,
  ChainChoices,
  OrderChoices
} from 'dexguru-sdk/dist/models/enums';
import { SwapBurnMintModel } from 'dexguru-sdk/dist/models/model';
import logger from '../logger';
import { AllSwaps } from './index';
import { ratelimit } from '../utils/promise-ratelimit';
import { retry } from '../utils/promise-retry';
import { getAddress, JsonRpcProvider, WebSocketProvider } from 'ethers';

const sdk = new DexGuru(
  'sMEPZRnAJyRF2Hnwl98SfrDfZlHdpNgGuzlLmJXG8HQ',
  'https://api.dev.dex.guru'
);

const getWalletSwaps = ratelimit(
  retry(sdk.getWalletSwaps.bind(sdk), { limit: 3, delayMs: 600 }),
  { limit: 5, delayMs: 1_000 }
);

export async function getAllSwaps(
  wallet: string,
  provider: JsonRpcProvider | WebSocketProvider,
  timestampStart: number,
  timestampEnd?: number
): Promise<AllSwaps | null> {
  let swaps: SwapBurnMintModel[] | null = null;
  try {
    const data = await getWalletSwaps(
      ChainChoices._1,
      wallet,
      AmmChoices.all,
      undefined,
      OrderChoices.asc,
      200,
      undefined,
      timestampStart,
      timestampEnd
    );
    swaps = data.data;
  } catch (e: any) {
    logger.warn(e);
    return null;
  }

  if (swaps.length === 0) return null;

  const allSwaps: AllSwaps = {
    swaps: [],
    fees: 0,
    start: swaps[0].timestamp * 1000
  };
  const promises: Promise<void>[] = [];

  for (const swap of swaps) {
    allSwaps.swaps.push({
      wallet,
      fee: 0n,
      tokenIn: swap.tokens_in.map((t: any) => getAddress(t.address)),
      tokenOut: swap.tokens_out.map((t: any) => getAddress(t.address)),
      amountIn: swap.tokens_in.map((t: any) => BigInt(t.amount)),
      amountOut: swap.tokens_out.map((t: any) => BigInt(t.amount))
    });
    const i = allSwaps.swaps.length - 1;
    promises.push(
      new Promise<void>(async (res) => {
        const receipt = await provider.getTransactionReceipt(
          swap.transaction_address
        );
        res();
        if (!receipt) return;
        allSwaps.swaps[i].fee = receipt.fee;
      })
    );
  }

  await Promise.all(promises);

  return allSwaps;
}
