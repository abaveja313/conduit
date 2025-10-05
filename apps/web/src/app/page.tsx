"use client"

import { useState, useRef, useEffect } from "react"
import { AnimatePresence } from "framer-motion"
import { Train, RefreshCw, ChevronRight, Send, Settings, CheckCircle2, FileText, Files, File, Github } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SetupModal } from "@/components/SetupModal"
import { FileService } from "@conduit/fs"
import { Markdown } from "@/components/ui/markdown"
import { streamAnthropicResponse } from "@/lib/anthropic-client"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { useFileChanges } from "@/hooks/useFileChanges"
import { formatDuration, formatMemory } from "@/lib/format"
import { DEFAULT_DIVIDER_POSITION, COMMIT_BANNER_TIMEOUT, STATUS_COLORS } from "@/lib/constants"
import * as wasm from "@conduit/wasm"

interface FileChange {
  path: string
  status: "created" | "modified" | "deleted"
  linesAdded: number
  linesRemoved: number
  // Diff regions are loaded on-demand when expanded
  diffRegions?: Array<{
    originalStart: number
    linesRemoved: number
    modifiedStart: number
    linesAdded: number
    removedLines: string[]
    addedLines: string[]
  }>
}

interface ToolCall {
  type: 'tool-use'
  toolName: string
  args: Record<string, unknown>
  result?: unknown
  startTime?: number
  endTime?: number
  duration?: number
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  toolCalls?: ToolCall[]
}

function MessageContentRenderer({
  content,
  toolCalls,
  messageId,
  expandedToolCalls,
  toggleToolCall
}: {
  content: string
  toolCalls: ToolCall[]
  messageId: string
  expandedToolCalls: Set<string>
  toggleToolCall: (messageId: string, toolIndex: number) => void
}) {
  const parts = content.split(/(\[TOOL_CALL:\d+(?::COMPLETE)?\])/g)

  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        const toolCallMatch = part.match(/\[TOOL_CALL:(\d+)(:(COMPLETE))?\]/)

        if (toolCallMatch) {
          const toolIndex = parseInt(toolCallMatch[1])
          const isComplete = !!toolCallMatch[3]
          const toolCall = toolCalls[toolIndex]

          if (!toolCall) return null

          const toolCallKey = `${messageId}-${toolIndex}`
          const isExpanded = expandedToolCalls.has(toolCallKey)

          return (
            <div key={index} className="my-2 border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggleToolCall(messageId, toolIndex)}
                className="w-full p-2 flex items-center justify-between hover:bg-secondary/50 text-left"
              >
                <div className="flex items-center gap-2">
                  <ChevronRight className={`h-3 w-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  <span className="text-xs font-medium text-muted-foreground">Tool:</span>
                  <span className="text-xs font-mono bg-background px-2 py-1 rounded">
                    {toolCall.toolName}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {toolCall.duration !== undefined && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {formatDuration(toolCall.duration)}
                    </span>
                  )}
                  {isComplete && <span className="text-xs text-green-500">✓</span>}
                  {!isComplete && toolCall.result === undefined && (
                    <span className="text-xs text-yellow-500">⋯</span>
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 text-xs">
                  {toolCall.args && Object.keys(toolCall.args).length > 0 && (
                    <div className="space-y-1">
                      <div className="font-medium text-muted-foreground">Arguments:</div>
                      <pre className="overflow-x-auto bg-background/50 p-2 rounded">
                        {JSON.stringify(toolCall.args, null, 2)}
                      </pre>
                    </div>
                  )}
                  {toolCall.result !== undefined && (
                    <div className="space-y-1">
                      <div className="font-medium text-muted-foreground">Result:</div>
                      {/* Special handling for line operation results */}
                      {(toolCall.toolName === 'replaceLines' || toolCall.toolName === 'deleteLines' || toolCall.toolName === 'insertLines') &&
                        typeof toolCall.result === 'object' && toolCall.result !== null &&
                        'linesAdded' in toolCall.result && 'linesReplaced' in toolCall.result ? (
                        <div className="bg-background/50 p-2 rounded text-xs space-y-1">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          <div>Path: {(toolCall.result as any).path}</div>
                          {(() => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const result = toolCall.result as any;
                            const netChange = result.linesAdded;
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            const originalLines = result.originalLines;
                            // eslint-disable-next-line @typescript-eslint/no-unused-vars
                            const totalLines = result.totalLines;

                            // For replaceLines with multi-line replacements
                            if (toolCall.toolName === 'replaceLines' && result.linesReplaced > 0) {
                              const actualLinesRemoved = result.linesReplaced;
                              const actualLinesAdded = result.linesReplaced + netChange;

                              return (
                                <>
                                  <div>Lines replaced: {result.linesReplaced}</div>
                                  {actualLinesAdded !== actualLinesRemoved && (
                                    <>
                                      <div className="text-green-500">Expanded to: {actualLinesAdded} lines</div>
                                      <div className="text-red-500">From: {actualLinesRemoved} lines</div>
                                    </>
                                  )}
                                  <div>Net change: {netChange > 0 ? '+' : ''}{netChange} lines</div>
                                </>
                              );
                            }

                            // For deleteLines
                            if (toolCall.toolName === 'deleteLines') {
                              return (
                                <>
                                  <div className="text-red-500">Lines deleted: {result.linesReplaced}</div>
                                  <div>Net change: {netChange} lines</div>
                                </>
                              );
                            }

                            // For insertLines
                            if (toolCall.toolName === 'insertLines') {
                              return (
                                <>
                                  <div className="text-green-500">Lines inserted: {netChange}</div>
                                  <div>Net change: +{netChange} lines</div>
                                </>
                              );
                            }

                            // Fallback
                            return <div>Net change: {netChange > 0 ? '+' : ''}{netChange} lines</div>;
                          })()}
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          <div>Total lines: {(toolCall.result as any).totalLines}</div>
                        </div>
                      ) : (
                        <pre className="overflow-x-auto bg-background/50 p-2 rounded">
                          {JSON.stringify(toolCall.result, null, 2)}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }

        if (part.trim()) {
          return <Markdown key={index} content={part} />
        }

        return null
      })}
    </div>
  )
}

export default function Home() {
  const [isSetupComplete, setIsSetupComplete] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isStagingCollapsed, setIsStagingCollapsed] = useState(false)
  const [currentModel, setCurrentModel] = useState("")
  const [fileService, setFileService] = useState<FileService | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [dividerPosition, setDividerPosition] = useState(DEFAULT_DIVIDER_POSITION)
  const isDragging = useRef(false)
  const [commitBanner, setCommitBanner] = useState<{
    show: boolean
    stats: {
      modified: number
      deleted: number
      total: number
    } | null
  }>({ show: false, stats: null })
  const [activeTab, setActiveTab] = useState("files")
  const [files, setFiles] = useState<Array<{
    path: string
    size: number
    mtime: number
    extension: string
    editable: boolean
  }>>([])
  const [filesTotal, setFilesTotal] = useState(0)
  const [filesPage, setFilesPage] = useState(0)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [expandedToolCalls, setExpandedToolCalls] = useState<Set<string>>(new Set())
  const [systemStats, setSystemStats] = useState({
    fileCount: 0,
    stagedFiles: 0,
    stagedDeletions: 0,
    heapUsed: 0,
    heapLimit: 0,
    avgLatency: 0
  })
  const [viewMode, setViewMode] = useState<Map<string, 'diff' | 'full'>>(new Map())
  const [fullFileContent, setFullFileContent] = useState<Map<string, React.ReactElement | null>>(new Map())
  const latencies = useRef<number[]>([])

  // Use the file changes hook
  const { fileChanges, expanded, updateFileChanges, toggleExpanded, setFileChanges, clearExpanded } = useFileChanges(fileService)

  // Initialize WASM on page load
  useEffect(() => {
    const initWasm = async () => {
      try {
        await wasm.default()
        wasm.init()
        console.log('WASM initialized')
      } catch (err) {
        console.error('Failed to initialize WASM:', err)
      }
    }
    initWasm()
  }, [])

  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'assistant' && lastMessage.toolCalls) {
      lastMessage.toolCalls.forEach(tc => {
        if (tc.duration && tc.duration > 0 && !latencies.current.includes(tc.duration)) {
          latencies.current.push(tc.duration)
          if (latencies.current.length > 50) {
            latencies.current.shift()
          }
        }
      })
    }
  }, [messages])

  useEffect(() => {
    const updateStats = async () => {
      if (fileService) {
        try {
          const mods = await fileService.getStagedModifications()
          const dels = await fileService.getStagedDeletions()

          interface PerformanceMemory {
            usedJSHeapSize: number
            jsHeapSizeLimit: number
          }
          const memory = (performance as typeof performance & { memory?: PerformanceMemory }).memory
          const heapUsed = memory?.usedJSHeapSize || 0
          const heapLimit = memory?.jsHeapSizeLimit || 0

          const recentLatencies = latencies.current.slice(-20)
          const avgLatency = recentLatencies.length > 0
            ? recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length
            : 0

          setSystemStats({
            fileCount: fileService.fileCount,
            stagedFiles: mods.length,
            stagedDeletions: dels.length,
            heapUsed,
            heapLimit,
            avgLatency
          })
        } catch {
        }
      }
    }
    updateStats()
    const interval = setInterval(updateStats, 1000)
    return () => clearInterval(interval)
  }, [fileService, fileChanges])

  const handleSetupComplete = (config: {
    provider: "anthropic"
    model: string
    fileService: FileService
  }) => {
    setIsSetupComplete(true)
    setCurrentModel(config.model)
    setFileService(config.fileService)
    loadFiles(config.fileService, 0)
  }

  const loadFiles = async (service: FileService, page: number) => {
    setLoadingFiles(true)
    try {
      const result = await service.listFiles({
        start: page * 20,
        limit: 20,
        useStaged: false
      })

      if (page === 0) {
        setFiles(result.files)
      } else {
        setFiles(prev => [...prev, ...result.files])
      }

      setFilesTotal(result.total)
      setFilesPage(page)
    } catch (error) {
      console.error('Failed to load files:', error)
    } finally {
      setLoadingFiles(false)
    }
  }

  const loadMoreFiles = () => {
    if (fileService && !loadingFiles && files.length < filesTotal) {
      loadFiles(fileService, filesPage + 1)
    }
  }


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || !fileService || isLoading) return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim()
    }

    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    setActiveTab("modifications")

    try {
      const apiKey = localStorage.getItem('anthropicApiKey') || ''

      const apiMessages = messages.concat(userMessage).map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content.replace(/\[TOOL_CALL:\d+(?::COMPLETE)?\]/g, '').trim()
      }))

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "",
        toolCalls: []
      }

      setMessages(prev => [...prev, assistantMessage])

      const stream = streamAnthropicResponse(
        apiMessages,
        apiKey,
        currentModel,
        fileService
      )

      for await (const event of stream) {
        switch (event.type) {
          case 'text':
            if (event.content) {
              assistantMessage.content += event.content
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
            }
            break

          case 'tool-use':
            if (event.toolCall) {
              const toolIndex = assistantMessage.toolCalls?.length || 0
              const toolCallWithTiming = {
                ...event.toolCall,
                startTime: Date.now()
              }
              assistantMessage.toolCalls?.push(toolCallWithTiming)
              assistantMessage.content += `\n[TOOL_CALL:${toolIndex}]`
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
            }
            break

          case 'tool-result':
            if (event.toolCall) {
              const toolIndex = assistantMessage.toolCalls?.findIndex(
                tc => tc.toolName === event.toolCall?.toolName && JSON.stringify(tc.args) === JSON.stringify(event.toolCall?.args)
              )
              if (toolIndex !== undefined && toolIndex >= 0 && assistantMessage.toolCalls) {
                const endTime = Date.now()
                const startTime = assistantMessage.toolCalls[toolIndex].startTime
                const duration = startTime ? endTime - startTime : undefined
                assistantMessage.toolCalls[toolIndex] = {
                  ...event.toolCall,
                  startTime,
                  endTime,
                  duration
                }
                const marker = `[TOOL_CALL:${toolIndex}]`
                const completeMarker = `[TOOL_CALL:${toolIndex}:COMPLETE]`
                assistantMessage.content = assistantMessage.content.replace(marker, completeMarker)
              }
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
              await updateFileChanges()
              clearExpanded() // Close previews on tool call
            }
            break

          case 'error':
            if (event.error) {
              assistantMessage.content += `\n\nError: ${event.error}`
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
            }
            break

          case 'done':
            break
        }
      }
    } catch (error) {
      console.error('Chat error:', error)
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: "assistant",
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
      }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleRestart = () => {
    setMessages([])
    setFileChanges([])
    clearExpanded()
    setExpandedToolCalls(new Set())
  }


  const toggleToolCall = (messageId: string, toolIndex: number) => {
    const key = `${messageId}-${toolIndex}`
    setExpandedToolCalls(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  const fetchFullFile = async (path: string) => {
    if (!fileService) return null

    try {
      // First, get a sample to know the total lines
      const sample = await fileService.readFile({
        path,
        lineRange: { start: 1, end: 1 }
      })

      // Then read the entire file
      const result = await fileService.readFile({
        path,
        lineRange: { start: 1, end: sample.totalLines }
      })

      // result.lines is an array of objects like [{1: "content"}, {2: "content"}]
      // We need to extract the line number and content from each object
      const lines = result.lines.map((lineObj: { [key: number]: string }) => {
        const [lineNum, content] = Object.entries(lineObj)[0]
        return { lineNum, content }
      })

      return (
        <div className="font-mono text-sm">
          {lines.map(({ lineNum, content }) => (
            <div key={lineNum} className="flex hover:bg-secondary/30 transition-colors">
              <span className="text-muted-foreground w-8 sm:w-12 text-right pr-1 sm:pr-2 select-none flex-shrink-0 text-[10px] sm:text-xs py-1 border-r border-border">
                {lineNum}
              </span>
              <span className="pl-2 pr-4 py-1 whitespace-pre">{content}</span>
            </div>
          ))}
        </div>
      )
    } catch (error) {
      console.error('Error loading file:', error)
      return <div className="text-sm text-red-500">Error loading file</div>
    }
  }

  const handleViewModeToggle = async (path: string) => {
    const currentMode = viewMode.get(path) || 'diff'
    const newMode = currentMode === 'diff' ? 'full' : 'diff'

    setViewMode(prev => {
      const next = new Map(prev)
      next.set(path, newMode)
      return next
    })

    // Fetch full file content if switching to full view
    if (newMode === 'full' && !fullFileContent.has(path)) {
      const content = await fetchFullFile(path)
      setFullFileContent(prev => {
        const next = new Map(prev)
        next.set(path, content)
        return next
      })
    }
  }

  // Override toggleExpanded to clear view mode when collapsing
  const handleToggleExpanded = (path: string) => {
    const isExpanded = expanded.has(path)
    if (isExpanded) {
      // Clearing - reset view mode and content
      setViewMode(prev => {
        const next = new Map(prev)
        next.delete(path)
        return next
      })
      setFullFileContent(prev => {
        const next = new Map(prev)
        next.delete(path)
        return next
      })
    }
    toggleExpanded(path)
  }

  const renderDiffRegions = (change: FileChange) => {
    if (!change.diffRegions || change.diffRegions.length === 0) {
      return (
        <div className="text-sm text-muted-foreground text-center py-4">
          Loading diff...
        </div>
      )
    }

    // For deleted files, show all content as removed
    if (change.status === 'deleted' && change.diffRegions.length === 1 &&
      change.diffRegions[0].linesRemoved > 0 && change.diffRegions[0].linesAdded === 0) {
      const region = change.diffRegions[0]
      return (
        <div>
          <div className="text-xs text-red-500 mb-2 font-sans">
            File deleted ({region.linesRemoved} lines removed)
          </div>
          <div className="font-mono text-sm">
            {region.removedLines.map((line, i) => (
              <div key={`del-${i}`} className="flex bg-red-500/10 border-l-4 border-red-500 min-w-fit">
                <span className="text-red-600 w-8 sm:w-12 text-right pr-1 sm:pr-2 select-none flex-shrink-0 text-[10px] sm:text-xs py-1">
                  {region.originalStart + i}
                </span>
                <span className="w-8 sm:w-12 text-center select-none flex-shrink-0 text-[10px] sm:text-xs py-1"></span>
                <span className="text-red-400 pl-2 pr-4 py-1 whitespace-pre">- {line}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    // For created files, show all content as added
    if (change.status === 'created' && change.diffRegions.length === 1 &&
      change.diffRegions[0].linesAdded > 0 && change.diffRegions[0].linesRemoved === 0) {
      const region = change.diffRegions[0]
      return (
        <div>
          <div className="text-xs text-green-500 mb-2 font-sans">
            File created ({region.linesAdded} lines added)
          </div>
          <div className="font-mono text-sm">
            {region.addedLines.map((line, i) => (
              <div key={`add-${i}`} className="flex bg-green-500/10 border-l-4 border-green-500 min-w-fit">
                <span className="w-8 sm:w-12 text-center select-none flex-shrink-0 text-[10px] sm:text-xs py-1"></span>
                <span className="text-green-600 w-8 sm:w-12 text-right pr-1 sm:pr-2 select-none flex-shrink-0 text-[10px] sm:text-xs py-1">
                  {region.modifiedStart + i}
                </span>
                <span className="text-green-400 pl-2 pr-4 py-1 whitespace-pre">+ {line}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    // Render inline diff regions
    const allLines: React.ReactElement[] = []
    let lineKey = 0

    change.diffRegions.forEach((region, idx) => {
      // Add a separator between regions if not the first one
      if (idx > 0) {
        allLines.push(
          <div key={`sep-${idx}`} className="h-4 relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border"></div>
            </div>
          </div>
        )
      }

      // For modifications, show removed lines followed by added lines
      if (region.linesRemoved > 0 && region.linesAdded > 0) {
        // This is a modification - add a header
        allLines.push(
          <div key={`header-${idx}`} className="text-xs text-muted-foreground py-2 px-4 bg-secondary/30">
            Modified: {region.linesRemoved} line{region.linesRemoved > 1 ? 's' : ''} → {region.linesAdded} line{region.linesAdded > 1 ? 's' : ''}
          </div>
        )
      }

      // Add removed lines
      region.removedLines.forEach((line, i) => {
        allLines.push(
          <div key={`del-${lineKey++}`} className="flex hover:bg-red-500/20 transition-colors min-w-fit">
            <span className="text-red-600 w-8 sm:w-12 text-right pr-1 sm:pr-2 select-none flex-shrink-0 text-[10px] sm:text-xs py-1 border-r border-red-500/20">
              {region.originalStart + i}
            </span>
            <span className="w-8 sm:w-12 text-center select-none flex-shrink-0 text-[10px] sm:text-xs py-1 border-r border-border"></span>
            <span className="text-red-500 pl-1 pr-2 select-none">−</span>
            <span className="text-red-400 pr-4 py-1 flex-1 whitespace-pre">{line}</span>
          </div>
        )
      })

      // Add added lines
      region.addedLines.forEach((line, i) => {
        allLines.push(
          <div key={`add-${lineKey++}`} className="flex hover:bg-green-500/20 transition-colors min-w-fit">
            <span className="w-8 sm:w-12 text-center select-none flex-shrink-0 text-[10px] sm:text-xs py-1 border-r border-border"></span>
            <span className="text-green-600 w-8 sm:w-12 text-right pr-1 sm:pr-2 select-none flex-shrink-0 text-[10px] sm:text-xs py-1 border-r border-green-500/20">
              {region.modifiedStart + i}
            </span>
            <span className="text-green-500 pl-1 pr-2 select-none">+</span>
            <span className="text-green-400 pr-4 py-1 flex-1 whitespace-pre">{line}</span>
          </div>
        )
      })
    })

    return (
      <div className="font-mono text-sm">
        {allLines}
      </div>
    )
  }

  const handleCommit = async () => {
    if (!fileService) return

    try {
      const result = await fileService.commitChanges()
      console.log(`Committed ${result.fileCount} files with ${result.modified.length} modifications and ${result.deleted.length} deletions`)

      setCommitBanner({
        show: true,
        stats: {
          modified: result.modified.length,
          deleted: result.deleted.length,
          total: result.fileCount
        }
      })

      setFileChanges([])

      // Refresh the files list to show the committed changes
      await loadFiles(fileService, 0)

      setTimeout(() => {
        setCommitBanner({ show: false, stats: null })
      }, COMMIT_BANNER_TIMEOUT)
    } catch (error) {
      console.error('Failed to commit changes:', error)
      alert('Failed to persist changes. Check console for details.')
    }
  }

  const handleRevert = async () => {
    if (!fileService) return

    try {
      await fileService.revertChanges()
      setFileChanges([])
      console.log('Reverted all staged changes')

      // Refresh the files list to reflect the reverted state
      await loadFiles(fileService, 0)
    } catch (error) {
      console.error('Failed to revert changes:', error)
      alert('Failed to revert changes. Check console for details.')
    }
  }

  const handleMouseDown = () => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging.current) return
    const newPosition = (e.clientX / window.innerWidth) * 100
    setDividerPosition(Math.min(Math.max(newPosition, 20), 80))
  }

  const handleMouseUp = () => {
    isDragging.current = false
    document.body.style.cursor = 'default'
    document.body.style.userSelect = 'auto'
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Header - Always visible */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Train className="h-6 w-6" />
          <h1 className="text-xl font-semibold">Conduit</h1>
        </div>
        <div className="flex items-center gap-2">
          {isSetupComplete && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSettings(true)}
                className="gap-2"
              >
                <Settings className="h-4 w-4" />
                Settings
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRestart}
                disabled={messages.length === 0}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Restart
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            asChild
          >
            <a
              href="https://github.com/abaveja313/conduit"
              target="_blank"
              rel="noopener noreferrer"
              className="gap-2"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {!isSetupComplete ? (
        <SetupModal open={true} onComplete={handleSetupComplete} />
      ) : (
        <div className="flex flex-1 overflow-hidden pb-9">
          {/* Settings Modal */}
          <SetupModal
            open={showSettings}
            onComplete={(config) => {
              handleSetupComplete(config)
              setShowSettings(false)
            }}
          />

          <div
            className="flex flex-col h-full overflow-hidden"
            style={{ width: messages.length > 0 && !isStagingCollapsed ? `${dividerPosition}%` : '100%' }}
          >

            {/* Chat Area */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {messages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-full max-w-2xl px-4">
                    <div className="flex flex-col items-center gap-8 mb-8">
                      <Train className="h-16 w-16 text-muted-foreground" />
                    </div>
                    <form onSubmit={handleSubmit}>
                      <div className="relative">
                        <Input
                          type="text"
                          placeholder="Ask me to read, create, or modify files..."
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          disabled={isLoading}
                          className="pr-24 h-12 text-base"
                        />
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                          <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                            Claude
                          </span>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={isLoading || !input.trim()}
                          >
                            <Send className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </form>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {messages.map(message => (
                      <div
                        key={message.id}
                        className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className="flex flex-col max-w-[80%]">
                          <div className={`rounded-lg p-4 ${message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-secondary'
                            }`}>
                            {message.role === 'user' ? (
                              <p className="text-sm">{message.content}</p>
                            ) : (
                              <MessageContentRenderer
                                content={message.content}
                                toolCalls={message.toolCalls || []}
                                messageId={message.id}
                                expandedToolCalls={expandedToolCalls}
                                toggleToolCall={toggleToolCall}
                              />
                            )}
                          </div>
                          {message.role === 'assistant' && isLoading && message.id === messages[messages.length - 1]?.id && (
                            <div className="flex items-center gap-1 mt-2 pl-4">
                              <span className="text-sm text-muted-foreground">Thinking</span>
                              <span className="flex gap-1">
                                <span className="animate-bounce" style={{ animationDelay: '0ms' }}>.</span>
                                <span className="animate-bounce" style={{ animationDelay: '150ms' }}>.</span>
                                <span className="animate-bounce" style={{ animationDelay: '300ms' }}>.</span>
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>

                  <form onSubmit={handleSubmit} className="p-4 border-t border-border">
                    <div className="relative">
                      <Input
                        type="text"
                        placeholder="Continue the conversation..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        disabled={isLoading}
                        className="pr-24 h-12 text-base"
                      />
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                        <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                          Claude
                        </span>
                        <Button
                          type="submit"
                          size="sm"
                          disabled={isLoading || !input.trim()}
                        >
                          <Send className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </form>
                </>
              )}
            </div>
          </div>

          {/* Draggable Divider */}
          {(messages.length > 0 || isSetupComplete) && !isStagingCollapsed && (
            <div
              className="w-1 bg-border hover:bg-primary/20 cursor-col-resize relative group"
              onMouseDown={handleMouseDown}
            >
              <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-primary/10" />
            </div>
          )}

          {/* Right Panel with Tabs */}
          <AnimatePresence>
            {(messages.length > 0 || isSetupComplete) && (
              <div
                className="border-l border-border bg-secondary/50 flex overflow-hidden"
                style={{ width: isStagingCollapsed ? "40px" : `${100 - dividerPosition}%`, minWidth: "40px" }}
              >
                <button
                  onClick={() => setIsStagingCollapsed(!isStagingCollapsed)}
                  className="w-10 hover:bg-secondary/80 flex items-center justify-center flex-shrink-0"
                >
                  <ChevronRight className={`h-4 w-4 transition-transform ${isStagingCollapsed ? '' : 'rotate-180'}`} />
                </button>

                {!isStagingCollapsed && (
                  <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                      <div className="p-2 sm:p-4 border-b border-border flex-shrink-0">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="files" className="flex items-center gap-2">
                            <Files className="h-4 w-4" />
                            Files
                          </TabsTrigger>
                          <TabsTrigger value="modifications" className="flex items-center gap-2">
                            <FileText className="h-4 w-4" />
                            Modifications
                          </TabsTrigger>
                        </TabsList>
                      </div>

                      <TabsContent value="files" className="flex-1 flex flex-col mt-0 min-h-0 overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-4 min-h-0 overflow-x-hidden">
                          {files.length === 0 && !loadingFiles ? (
                            <p className="text-muted-foreground text-center mt-8">
                              No files loaded
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {files.map((file) => (
                                <div key={file.path} className="flex items-center gap-2 p-2 hover:bg-secondary/50 rounded group">
                                  <File className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                  <span className="text-sm font-mono truncate flex-1 min-w-0">{file.path}</span>
                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {!file.editable && (
                                      <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/10 text-orange-600 dark:text-orange-400 font-medium">
                                        Read-only
                                      </span>
                                    )}
                                    {file.extension && (
                                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                                        {file.extension}
                                      </span>
                                    )}
                                    <span className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)}KB</span>
                                  </div>
                                </div>
                              ))}

                              {files.length < filesTotal && (
                                <div className="mt-4 text-center pb-4">
                                  <Button
                                    onClick={loadMoreFiles}
                                    variant="outline"
                                    size="sm"
                                    disabled={loadingFiles}
                                  >
                                    {loadingFiles ? (
                                      <>
                                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                        Loading...
                                      </>
                                    ) : (
                                      <>Load More ({files.length} of {filesTotal})</>
                                    )}
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </TabsContent>

                      <TabsContent value="modifications" className="flex-1 flex flex-col mt-0 min-h-0 overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-4 min-h-0 overflow-x-hidden">
                          {commitBanner.show && commitBanner.stats && (
                            <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                                  <span className="font-medium text-green-500">Changes Persisted Successfully</span>
                                </div>
                                <button
                                  onClick={() => setCommitBanner({ show: false, stats: null })}
                                  className="text-green-500 hover:text-green-600"
                                >
                                  ×
                                </button>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                {commitBanner.stats.modified} files modified
                                {commitBanner.stats.deleted > 0 && `, ${commitBanner.stats.deleted} files deleted`}
                              </div>
                            </div>
                          )}
                          {fileChanges.length === 0 ? (
                            <p className="text-muted-foreground text-center mt-8">
                              No files modified yet
                            </p>
                          ) : (
                            <div className="space-y-2">
                              {fileChanges.map((change) => (
                                <div key={change.path} className="rounded-lg border border-border overflow-hidden">
                                  <button
                                    onClick={() => handleToggleExpanded(change.path)}
                                    className="w-full p-3 flex items-center justify-between hover:bg-secondary/50 text-left min-w-0"
                                  >
                                    <span className="text-sm font-mono truncate flex-1 min-w-0">{change.path}</span>
                                    <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                                      {change.linesAdded > 0 && (
                                        <span className="text-xs text-green-500">+{change.linesAdded}</span>
                                      )}
                                      {change.linesRemoved > 0 && (
                                        <span className="text-xs text-red-500">-{change.linesRemoved}</span>
                                      )}
                                      <span className={`text-xs px-1 py-0.5 rounded-full ${STATUS_COLORS[change.status]}`}>
                                        {change.status}
                                      </span>
                                    </div>
                                  </button>

                                  {expanded.has(change.path) && (
                                    <div className="bg-background/50 border-t border-border overflow-hidden">
                                      {change.status === 'modified' && (
                                        <div className="flex items-center justify-between p-2 sm:p-4 pb-0 sm:pb-0">
                                          <span className="text-xs text-muted-foreground">
                                            {viewMode.get(change.path) === 'full' ? 'Full File' : 'Changes Only'}
                                          </span>
                                          <button
                                            onClick={() => handleViewModeToggle(change.path)}
                                            className="text-xs px-2 py-1 rounded hover:bg-secondary transition-colors"
                                          >
                                            {viewMode.get(change.path) === 'full' ? 'Show Diff' : 'Show Full File'}
                                          </button>
                                        </div>
                                      )}
                                      <div className="p-2 sm:p-4 overflow-x-auto overflow-y-hidden">
                                        {change.status === 'modified' && viewMode.get(change.path) === 'full'
                                          ? (fullFileContent.get(change.path) || <div className="text-sm text-muted-foreground">Loading...</div>)
                                          : renderDiffRegions(change)
                                        }
                                      </div>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {fileChanges.length > 0 && (
                          <div className="p-4 border-t border-border flex gap-2 flex-shrink-0">
                            <Button onClick={handleCommit} className="flex-1" disabled={isLoading}>
                              Persist to Disk
                            </Button>
                            <Button onClick={handleRevert} variant="outline" className="flex-1" disabled={isLoading}>
                              Revert All
                            </Button>
                          </div>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </div>
            )}
          </AnimatePresence>

          {/* System Stats Footer */}
          {isSetupComplete && (
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 border-t border-border px-4 py-2 flex items-center justify-between text-xs font-mono backdrop-blur-sm">
              <div className="flex items-center gap-4 text-muted-foreground">
                <span>files: {systemStats.fileCount.toLocaleString()}</span>
                {systemStats.stagedFiles > 0 && (
                  <span className="text-blue-500">staged: {systemStats.stagedFiles}</span>
                )}
                {systemStats.stagedDeletions > 0 && (
                  <span className="text-red-500">deleted: {systemStats.stagedDeletions}</span>
                )}
                {systemStats.heapUsed > 0 && (
                  <span>heap: {formatMemory(systemStats.heapUsed)} / {formatMemory(systemStats.heapLimit)}</span>
                )}
                {systemStats.avgLatency > 0 && (
                  <span>avg: {formatDuration(systemStats.avgLatency)}</span>
                )}
              </div>
              <div className="text-muted-foreground">
                🎄 made by <a href='https://github.com/abaveja313' target="_blank"><u>amrit</u></a> in stanford, ca
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}