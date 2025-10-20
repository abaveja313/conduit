import { useState, useCallback } from 'react'
import { FileService } from '@conduit/fs'
import { createLogger } from '@conduit/shared'

const logger = createLogger('web:hooks:file-changes')

interface FileChange {
  path: string
  status: "created" | "modified" | "deleted" | "moved"
  linesAdded: number
  linesRemoved: number
  movedTo?: string
  diffRegions?: Array<{
    originalStart: number
    linesRemoved: number
    modifiedStart: number
    linesAdded: number
    removedLines: string[]
    addedLines: string[]
  }>
}

export function useFileChanges(fileService: FileService | null) {
  const [fileChanges, setFileChanges] = useState<FileChange[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const updateFileChanges = useCallback(async () => {
    if (!fileService) return

    try {
      const summaries = await fileService.getModifiedFilesSummary()
      setFileChanges(summaries)
    } catch (error) {
      logger.debug('No staged modifications available:', error)
    }
  }, [fileService])

  const fetchDiffRegions = useCallback(async (path: string) => {
    if (!fileService) return

    try {
      const diff = await fileService.getFileDiff(path)

      setFileChanges(prev => prev.map(change =>
        change.path === path
          ? { ...change, diffRegions: diff.regions }
          : change
      ))
    } catch (error) {
      logger.error('Failed to fetch diff regions:', error)
    }
  }, [fileService])

  const toggleExpanded = useCallback(async (path: string) => {
    setExpanded(prev => {
      const next = new Set<string>()
      if (!prev.has(path)) {
        next.add(path)
        fetchDiffRegions(path)
      }
      return next
    })
  }, [fetchDiffRegions])

  const clearExpanded = useCallback(() => {
    setExpanded(new Set())
  }, [])

  return {
    fileChanges,
    expanded,
    updateFileChanges,
    toggleExpanded,
    setFileChanges,
    clearExpanded
  }
}
