import { useQuery } from '@tanstack/react-query'
import { getFilePreview } from '../api/files.js'

/** 查询文件预览，未选择文件时保持禁用。 */
export function useFilePreview(fileId: string | null) {
  return useQuery({
    queryKey: ['file-preview', fileId],
    queryFn: () => getFilePreview(fileId ?? ''),
    enabled: fileId !== null,
  })
}
