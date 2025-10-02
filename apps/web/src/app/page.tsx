"use client"

import { useState, useRef, useEffect } from "react"
import { AnimatePresence } from "framer-motion"
import { Train, RefreshCw, ChevronRight, Send, Settings, CheckCircle2, FileText, Files, File } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SetupModal } from "@/components/SetupModal"
import { FileService } from "@conduit/fs"
import { Markdown } from "@/components/ui/markdown"
import { streamAnthropicResponse } from "@/lib/anthropic-client"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

interface CodeSnippet {
  start: number
  lines: string[]
}

interface FileChange {
  path: string
  status: "created" | "modified" | "deleted"
  snippet?: CodeSnippet
  activeSnippet?: CodeSnippet
  stagedSnippet?: CodeSnippet
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

// Component to render message content with inline tool calls
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
  // Split content by tool call markers
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
                      {toolCall.duration < 1000 ? `${toolCall.duration}ms` : `${(toolCall.duration / 1000).toFixed(2)}s`}
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
                      <pre className="overflow-x-auto bg-background/50 p-2 rounded max-h-60">
                        {JSON.stringify(toolCall.result, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        }

        // Regular text content
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
  const [fileChanges, setFileChanges] = useState<FileChange[]>([])
  const [isStagingCollapsed, setIsStagingCollapsed] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [currentModel, setCurrentModel] = useState("")
  const [fileService, setFileService] = useState<FileService | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [dividerPosition, setDividerPosition] = useState(50) // percentage
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
  const latencies = useRef<number[]>([])

  // Track latencies from completed tool calls
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

  // Update system stats periodically
  useEffect(() => {
    const updateStats = async () => {
      if (fileService) {
        try {
          const mods = await fileService.getStagedModifications()
          const dels = await fileService.getStagedDeletions()

          // Get memory stats (Chrome/Edge only)
          interface PerformanceMemory {
            usedJSHeapSize: number
            jsHeapSizeLimit: number
          }
          const memory = (performance as typeof performance & { memory?: PerformanceMemory }).memory
          const heapUsed = memory?.usedJSHeapSize || 0
          const heapLimit = memory?.jsHeapSizeLimit || 0

          // Calculate average latency from recent tool calls
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
          // Ignore errors when no staging active
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
    // Load initial files
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

  const updateFileChanges = async () => {
    if (!fileService) return

    try {
      const modifications = await fileService.getStagedModifications()
      const deletions = await fileService.getStagedDeletions()

      const modifiedChanges = modifications.map(mod => ({
        path: mod.path,
        status: 'modified' as const,
        stagedSnippet: {
          start: 1,
          lines: mod.content?.split('\n') || []
        }
      }))

      const deletedChanges = deletions.map((path: string) => ({
        path,
        status: 'deleted' as const,
        snippet: undefined
      }))

      setFileChanges([...modifiedChanges, ...deletedChanges])
    } catch (error) {
      console.log('No staged modifications available:', error)
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

    // Switch to modifications tab when running a query
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

      // Use the new streaming function
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
              // Add a marker in the content where this tool call occurred
              assistantMessage.content += `\n[TOOL_CALL:${toolIndex}]`
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
            }
            break

          case 'tool-result':
            if (event.toolCall) {
              // Update the tool call with its result
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
                // Update the marker to show the tool has completed
                const marker = `[TOOL_CALL:${toolIndex}]`
                const completeMarker = `[TOOL_CALL:${toolIndex}:COMPLETE]`
                assistantMessage.content = assistantMessage.content.replace(marker, completeMarker)
              }
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
              await updateFileChanges()
            }
            break

          case 'error':
            if (event.error) {
              assistantMessage.content += `\n\nError: ${event.error}`
              setMessages(prev => [...prev.slice(0, -1), { ...assistantMessage }])
            }
            break

          case 'done':
            // Stream completed
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
    setExpanded(new Set())
    setExpandedToolCalls(new Set())
  }

  const toggleExpanded = (path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
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

  const renderCode = (snippet: CodeSnippet | undefined, tint?: "red" | "green") => {
    if (!snippet) return null

    const tintClass = tint === "red" ? "bg-red-500/10" : tint === "green" ? "bg-green-500/10" : ""
    const lineNumberClass = tint === "red" ? "text-red-500" : tint === "green" ? "text-green-500" : "text-muted-foreground"

    return (
      <pre className={`${tintClass} rounded-md p-4 overflow-x-auto`}>
        <code className="text-sm font-mono">
          {snippet.lines.map((line, i) => (
            <div key={i} className="flex">
              <span className={`${lineNumberClass} mr-4 select-none`}>
                {String(snippet.start + i).padStart(4, ' ')}
              </span>
              <span>{line}</span>
            </div>
          ))}
        </code>
      </pre>
    )
  }

  // Handle commit and revert operations
  const handleCommit = async () => {
    if (!fileService) return

    try {
      const result = await fileService.commitChanges()
      console.log(`Committed ${result.fileCount} files with ${result.modified.length} modifications and ${result.deleted.length} deletions`)

      // Show success banner
      setCommitBanner({
        show: true,
        stats: {
          modified: result.modified.length,
          deleted: result.deleted.length,
          total: result.fileCount
        }
      })

      // Clear changes
      setFileChanges([])

      // Hide banner after 5 seconds
      setTimeout(() => {
        setCommitBanner({ show: false, stats: null })
      }, 5000)
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

  if (!isSetupComplete) {
    return <SetupModal open={true} onComplete={handleSetupComplete} />
  }

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden pb-9">
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
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Train className="h-6 w-6" />
            <h1 className="text-xl font-semibold">Conduit</h1>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <form onSubmit={handleSubmit} className="w-full max-w-2xl px-4">
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
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {messages.map(message => (
                  <div
                    key={message.id}
                    className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] rounded-lg p-4 ${message.role === 'user'
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
            style={{ width: isStagingCollapsed ? "40px" : `${100 - dividerPosition}%` }}
          >
            <button
              onClick={() => setIsStagingCollapsed(!isStagingCollapsed)}
              className="w-10 hover:bg-secondary/80 flex items-center justify-center flex-shrink-0"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${isStagingCollapsed ? '' : 'rotate-180'}`} />
            </button>

            {!isStagingCollapsed && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
                  <div className="p-4 border-b border-border flex-shrink-0">
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

                  <TabsContent value="files" className="flex-1 overflow-hidden mt-0 flex flex-col">
                    <div className="flex-1 overflow-y-auto p-4">
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

                  <TabsContent value="modifications" className="flex-1 flex flex-col overflow-hidden mt-0">
                    <div className="flex-1 overflow-y-auto p-4 pb-0">
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
                        <div className="space-y-2 pb-4">
                          {fileChanges.map((change) => (
                            <div key={change.path} className="rounded-lg border border-border overflow-hidden">
                              <button
                                onClick={() => toggleExpanded(change.path)}
                                className="w-full p-3 flex items-center justify-between hover:bg-secondary/50 text-left"
                              >
                                <span className="text-sm font-mono truncate flex-1">{change.path}</span>
                                <span className={`text-xs px-2 py-1 rounded-full ml-2 ${change.status === 'created' ? 'bg-green-500/20 text-green-500' :
                                  change.status === 'deleted' ? 'bg-red-500/20 text-red-500' :
                                    'bg-blue-500/20 text-blue-500'
                                  }`}>
                                  {change.status}
                                </span>
                              </button>

                              {expanded.has(change.path) && (
                                <div className="p-4 bg-background/50 space-y-4">
                                  {change.status === 'deleted' ? (
                                    renderCode(change.snippet, "red")
                                  ) : change.status === 'created' ? (
                                    renderCode(change.snippet, "green")
                                  ) : (
                                    <>
                                      <div>
                                        <h4 className="text-sm font-semibold mb-2 text-red-500">Active</h4>
                                        {renderCode(change.activeSnippet, "red")}
                                      </div>
                                      <div>
                                        <h4 className="text-sm font-semibold mb-2 text-green-500">Staged</h4>
                                        {renderCode(change.stagedSnippet, "green")}
                                      </div>
                                    </>
                                  )}
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
              <span>heap: {(systemStats.heapUsed / 1024 / 1024).toFixed(0)}MB / {(systemStats.heapLimit / 1024 / 1024).toFixed(0)}MB</span>
            )}
            {systemStats.avgLatency > 0 && (
              <span>avg: {systemStats.avgLatency < 1000 ? `${Math.round(systemStats.avgLatency)}ms` : `${(systemStats.avgLatency / 1000).toFixed(2)}s`}</span>
            )}
          </div>
          <div className="text-muted-foreground">
            ♥ made by amrit in stanford, ca
          </div>
        </div>
      )}
    </div>
  )
}