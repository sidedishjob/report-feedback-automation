import { SSMClient, GetParametersCommand } from "@aws-sdk/client-ssm";

const DEFAULT_SSM_PREFIX = "/report/";

export const isLambda = (): boolean => {
  return !!(
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.AWS_EXECUTION_ENV ||
    process.env.LAMBDA_TASK_ROOT
  );
};

let ssmClient: SSMClient | null = null;

const getSSMClient = (): SSMClient => {
  if (!ssmClient) {
    ssmClient = new SSMClient({});
  }
  return ssmClient;
};

const valueCache = new Map<string, string | null>();

// 一括でSSMから取得してキャッシュに詰める（初回のみ）
const preloadFromSSM = async (keys: string[]): Promise<void> => {
  const prefix = process.env.SSM_PREFIX || DEFAULT_SSM_PREFIX;

  const client = getSSMClient();
  const names = keys.map((k) => `${prefix}${k}`);

  const res = await client.send(
    new GetParametersCommand({
      Names: names,
      WithDecryption: true,
    }),
  );

  const invalid = res.InvalidParameters ?? [];
  if (invalid.length > 0) {
    // missingは環境変数フォールバックもあり得るのでwarn止まり
    console.warn(`[WARN] Missing SSM parameters: ${invalid.join(", ")}`);
  }

  for (const p of res.Parameters ?? []) {
    if (!p.Name) continue;
    const key = p.Name.replace(prefix, "");
    valueCache.set(key, p.Value ?? null);
  }
};

export const getEnvValue = async (key: string): Promise<string | undefined> => {
  // キャッシュをチェック
  if (valueCache.has(key)) {
    const cached = valueCache.get(key);
    return cached === null ? undefined : cached;
  }

  // ローカルは環境変数のみ
  if (!isLambda()) {
    const v = process.env[key];
    valueCache.set(key, v ?? null);
    return v;
  }

  // Lambda：必要になったキー単体でキャッシュを埋める（最低限の仕組み）
  // ※ initializeConfig側でまとめて preload するのが本命（下で対応）
  try {
    await preloadFromSSM([key]);
    const cached = valueCache.get(key);
    if (cached != null) return cached;

    // フォールバック（念のため）
    const v = process.env[key];
    valueCache.set(key, v ?? null);
    return v;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ERROR] Failed to get ${key} from SSM. message=${msg}`);

    const v = process.env[key];
    valueCache.set(key, v ?? null);
    return v;
  }
};

export const getRequiredEnvValue = async (key: string): Promise<string> => {
  const value = await getEnvValue(key);
  if (!value) {
    throw new Error(`Missing env: ${key}`);
  }
  return value;
};

// まとめてプリロードしたいとき用（config.tsから呼ぶ）
export const preloadEnvValues = async (keys: string[]): Promise<void> => {
  if (!isLambda()) return;
  // すでに全部キャッシュ済みなら何もしない
  const need = keys.filter((k) => !valueCache.has(k));
  if (need.length === 0) return;

  await preloadFromSSM(need);
};

/** テスト用: 環境変数キャッシュをクリア */
export const clearCacheForTesting = (): void => {
  valueCache.clear();
};
