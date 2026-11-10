import {resolve,dirname} from 'node:path';
import {isTaskId,TeamError} from '../../lib/ai-team.js';

export function resultPath(destination,jobId,executionId) {
  if(!isTaskId(jobId)||!isTaskId(executionId))
    throw new TeamError('成果物の依頼ID・実行IDはUUID形式が必要です');
  const directory=resolve(destination);
  const path=resolve(directory,`${jobId}-${executionId}.json`);
  if(dirname(path)!==directory)
    throw new TeamError('成果物の保存先が専用ディレクトリ外です');
  return path;
}
