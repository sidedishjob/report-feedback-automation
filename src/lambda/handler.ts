// ESMなので import末尾は .js（tsc後の出力に合わせる）
import { runBatch } from '../batch/runBatch.js';

// export名は handler にする（Lambda設定で指定するため）
export const handler = async (): Promise<void> => {
	await runBatch();
};
