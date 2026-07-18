import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport, type StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  cppPilotContextEnvelopeSchema,
  toolResultSchema,
  type AgentRun,
  type AgentRunDetail,
  type DebugCommand,
  type DebugSessionState,
  type ContextPacket,
  type CppPilotContextEnvelope,
  type FileTreeNode,
  type LearnerKnowledge,
  type OpenAiFunctionTool,
  type TimelineEvent,
  type Approval,
  type ToolCall,
  type ToolResult
} from '@cpp-pet/contracts'
import { AppDatabase } from '@cpp-pet/database'
import { WorkspaceService, safePath } from '@cpp-pet/workspace-core'
import {
  createLocalMcpServer,
  localToolDefinitions,
  runProcess,
  runtimeDiagnostics,
  ToolchainService,
  ToolExecutionError,
  type LocalMcpAdapter,
  type LocalMcpExecutionContext
} from '@cpp-pet/cpp-local-tools'
import { GdbMiSession } from '@cpp-pet/cpp-local-tools/debugger'
import {
  buildExplanationContext,
  builtInKnowledge,
  nextReviewDate,
  reviewIntervalsDays,
  OpenAiResponsesClient,
  type ResolvedAgentRequest,
  type RuntimeContextBuilder,
  type RuntimeStore,
  type RuntimeToolClient,
  type RuntimeToolProgress,
  type OpenAiAgentContextBuilder,
  type OpenAiAgentModelFactory
} from '@cpp-pet/agent-runtime'

function flattenFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes.flatMap(node => [node, ...(node.children ? flattenFileTree(node.children) : [])])
}

export class DatabaseRuntimeStore implements RuntimeStore {
  constructor(private readonly db: AppDatabase) {}
  create(run: AgentRun): void { this.db.createAgentRun(run) }
  update(run: AgentRun): void { this.db.updateAgentRun(run) }
  append(event: TimelineEvent): void { this.db.appendTimeline(event) }
  saveApproval(approval: Approval): void { this.db.saveApproval(approval) }
  saveToolCall(call: ToolCall): void { this.db.saveToolCall(call) }
  get(runId: string): AgentRunDetail | undefined { return this.db.getAgentRun(runId) }
  list(): AgentRun[] { return this.db.listAgentRuns() }
  learnerKnowledge(userId: string): LearnerKnowledge[] { return this.db.listLearnerKnowledge(userId) }
}

export class DesktopContextBuilder implements RuntimeContextBuilder {
  constructor(private readonly workspaceService: WorkspaceService, private readonly db: AppDatabase) {}

  async build(request: ResolvedAgentRequest): Promise<ContextPacket> {
    const sources: ContextPacket['sources'] = []
    if (request.selection) {
      sources.push({
        kind: 'selection',
        label: `${request.activeFile ?? '选区'}:${request.selection.startLine}-${request.selection.endLine}`,
        content: request.selection.content,
        trusted: true,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(request.activeFile ? { relativePath: request.activeFile } : {})
      })
    }
    if (request.projectId && request.activeFile && !(request.mode === 'explain' && request.selection)) {
      const document = this.workspaceService.readFile(request.projectId, request.activeFile)
      sources.push({
        kind: 'file',
        label: request.activeFile,
        content: document.content.slice(0, 100_000),
        trusted: true,
        projectId: request.projectId,
        relativePath: request.activeFile,
        metadata: { contentHash: document.contentHash, truncated: document.content.length > 100_000 }
      })
    }
    if (request.projectId) {
      const project = this.db.getProject(request.projectId)
      const files = flattenFileTree(this.workspaceService.listTree(request.projectId)).slice(0, 200)
      sources.push({
        kind: 'project-tree',
        label: project?.name ?? '当前项目',
        content: JSON.stringify({ name: project?.name ?? '当前项目', type: project?.type ?? 'single-file', files }),
        trusted: true,
        projectId: request.projectId
      })
    }
    const liveDiagnostics = request.diagnostics ?? []
    const incidentDiagnostics = request.projectId
      ? this.db.listActiveDiagnosticIncidents(request.projectId).flatMap(incident => incident.groups.flatMap(group => group.occurrences.map(occurrence => ({
          source: group.source,
          severity: group.severity,
          ...(group.code ? { code: group.code } : {}),
          ...(occurrence.file ? { file: occurrence.file } : {}),
          ...(occurrence.line ? { line: occurrence.line } : {}),
          ...(occurrence.column ? { column: occurrence.column } : {}),
          rawMessage: occurrence.rawMessage,
          normalizedMessage: occurrence.normalizedMessage,
          relatedConceptIds: []
        }))))
      : []
    const diagnostics = [...liveDiagnostics, ...incidentDiagnostics].slice(0, 200)
    if (diagnostics.length) {
      sources.push({
        kind: 'diagnostic',
        label: `当前诊断（${diagnostics.length}）`,
        content: JSON.stringify(diagnostics),
        trusted: true,
        ...(request.projectId ? { projectId: request.projectId } : {}),
        ...(request.activeFile ? { relativePath: request.activeFile } : {})
      })
    }
    const backgroundProfile = this.db.getBackgroundProfile('local-user')
    const knowledge = this.db.listLearnerKnowledge('local-user')
    const activeKnowledgeIds = knowledge
      .filter(item => ['learning', 'self-claimed', 'verified', 'review'].includes(item.status))
      .map(item => item.conceptId)
    const mergedProfile = backgroundProfile
      ? { ...backgroundProfile, studiedConceptIds: [...new Set([...backgroundProfile.studiedConceptIds, ...activeKnowledgeIds])] }
      : undefined
    const explanationContext = buildExplanationContext(builtInKnowledge, mergedProfile, [])
    const relevantErrors = this.db.listErrorBookEntries('local-user').slice(0, 50).map(error => ({
      category: error.category,
      title: error.title,
      conceptIds: error.conceptIds,
      status: error.status
    }))
    const dueReviews = this.db.listReviewItems('local-user', true).slice(0, 50).map(review => ({ conceptId: review.conceptId, dueAt: review.dueAt }))
    sources.push({
      kind: 'learning',
      label: '学习状态',
      content: JSON.stringify({
        startingPoint: backgroundProfile?.startingPoint ?? 'zero-beginner',
        knowledge: knowledge.map(item => ({ conceptId: item.conceptId, status: item.status, confidence: item.confidence })),
        focusConceptIds: explanationContext.focusConceptIds,
        relevantErrors,
        dueReviews,
        teachingInstructions: explanationContext.instructions
      }),
      trusted: true
    })
    if (request.projectId && request.conversationId) {
      const messages = this.db.listAgentMessages(request.projectId, request.conversationId)
        .filter(message => message.content.trim() && ['completed', 'stopped', 'interrupted'].includes(message.status))
        .slice(-20)
        .map(message => ({ role: message.role, content: message.content }))
      if (messages.length) {
        sources.push({ kind: 'memory', label: '近期对话', content: JSON.stringify({ messages }), trusted: true, projectId: request.projectId })
      }
    }
    const activeToolchainId = this.db.getSettings().activeToolchainId
    const toolchain = activeToolchainId ? this.db.getToolchainProfile(activeToolchainId) : undefined
    sources.push({
      kind: 'tool',
      label: '开发环境',
      content: JSON.stringify({
        cppStandard: 'c++17',
        ...(toolchain ? { compiler: `${toolchain.family} ${toolchain.version}` } : {}),
        cmakeAvailable: Boolean(toolchain?.capabilities.compileDatabase)
      }),
      trusted: true
    })
    if (request.screenshot) {
      sources.push({
        kind: 'screenshot',
        label: `截图 ${request.screenshot.width}×${request.screenshot.height}`,
        content: JSON.stringify({ id: request.screenshot.id, width: request.screenshot.width, height: request.screenshot.height, mimeType: request.screenshot.mimeType }),
        trusted: false
      })
    }
    const characters = sources.reduce((sum, source) => sum + source.content.length, 0)
    return {
      requestId: request.requestId,
      sources,
      conceptIds: explanationContext.knownConceptIds,
      explanationContext,
      tokenEstimate: Math.ceil(characters / 4),
      truncated: sources.some(source => source.metadata?.truncated === true)
    }
  }
}

export class DesktopOpenAiContextBuilder implements OpenAiAgentContextBuilder {
  constructor(private readonly workspaceService: WorkspaceService, private readonly db: AppDatabase) {}

  async build(
    request: ResolvedAgentRequest,
    taskId: string,
    turn: number,
    _signal: AbortSignal
  ): Promise<CppPilotContextEnvelope> {
    const project = request.projectId ? this.db.getProject(request.projectId) : undefined
    const tree = request.projectId ? flattenFileTree(this.workspaceService.listTree(request.projectId)) : []
    const relatedFiles = tree.filter(node => node.kind === 'file').map(node => node.relativePath).slice(0, 200)
    const activeDocument = request.projectId && request.activeFile
      ? this.workspaceService.readFile(request.projectId, request.activeFile)
      : undefined
    const liveDiagnostics = request.diagnostics ?? []
    const incidentDiagnostics = request.projectId
      ? this.db.listActiveDiagnosticIncidents(request.projectId).flatMap(incident => incident.groups.flatMap(group => group.occurrences.map(occurrence => ({
          source: group.source,
          severity: group.severity,
          ...(group.code ? { code: group.code } : {}),
          ...(occurrence.file ? { file: occurrence.file } : {}),
          ...(occurrence.line ? { line: occurrence.line } : {}),
          ...(occurrence.column ? { column: occurrence.column } : {}),
          message: occurrence.normalizedMessage || occurrence.rawMessage
        }))))
      : []
    const diagnostics = [
      ...liveDiagnostics.map(item => ({
        source: item.source,
        severity: item.severity,
        ...(item.code ? { code: item.code } : {}),
        ...(item.file ? { file: item.file } : {}),
        ...(item.line ? { line: item.line } : {}),
        ...(item.column ? { column: item.column } : {}),
        message: item.normalizedMessage || item.rawMessage
      })),
      ...incidentDiagnostics
    ].slice(0, 200)
    const recentConversation = request.projectId && request.conversationId
      ? this.db.listAgentMessages(request.projectId, request.conversationId)
          .filter(message => message.content.trim())
          .slice(-20)
          .map(message => ({ role: message.role, content: message.content }))
      : []
    const learnerProfile = this.db.getBackgroundProfile('local-user') ?? {}
    const knowledgeState = this.db.listLearnerKnowledge('local-user').slice(0, 200).map(item => ({
      conceptId: item.conceptId, status: item.status, confidence: item.confidence
    }))
    const relevantErrors = this.db.listErrorBookEntries('local-user').slice(0, 50).map(item => ({
      category: item.category, title: item.title, conceptIds: item.conceptIds, status: item.status
    }))
    const dueReviews = this.db.listReviewItems('local-user', true).slice(0, 50).map(item => ({
      conceptId: item.conceptId, dueAt: item.dueAt
    }))
    const activeToolchainId = this.db.getSettings().activeToolchainId
    const toolchain = activeToolchainId ? this.db.getToolchainProfile(activeToolchainId) : undefined
    const allowedPaths = [...new Set([
      ...(request.activeFile ? [request.activeFile] : []),
      ...relatedFiles
    ])].slice(0, 500)

    return cppPilotContextEnvelopeSchema.parse({
      protocol: 'cpppilot.context.v1', taskId, turn,
      task: {
        prompt: request.message,
        source: request.source === 'editor' ? 'workspace' : request.source,
        ...(request.activeFile ? { activeFile: request.activeFile } : {}),
        ...(request.selection ? {
          selection: {
            startLine: request.selection.startLine,
            endLine: request.selection.endLine,
            content: request.selection.content
          }
        } : {})
      },
      workspace: {
        ...(project ? { project: { id: project.id, name: project.name, type: project.type } } : {}),
        ...(activeDocument ? {
          activeFile: {
            path: activeDocument.relativePath,
            content: activeDocument.content.slice(0, 100_000),
            contentHash: activeDocument.contentHash,
            dirty: false,
            truncated: activeDocument.content.length > 100_000
          }
        } : {}),
        relatedFiles,
        diagnostics,
        environment: {
          cppStandard: 'c++17',
          ...(toolchain ? { compiler: `${toolchain.family} ${toolchain.version}` } : {}),
          cmakeAvailable: Boolean(toolchain?.capabilities.compileDatabase)
        }
      },
      memory: {
        recentConversation,
        learnerProfile,
        knowledgeState,
        relevantErrors,
        dueReviews,
        recentEvidence: []
      },
      policy: {
        ...(request.projectId ? { allowedProjectId: request.projectId } : {}),
        allowedPaths,
        writesRequireApproval: true,
        maxModelTurns: 12,
        maxToolCalls: 20,
        remainingTimeMs: 120_000
      }
    })
  }
}

export class DesktopOpenAiModelFactory implements OpenAiAgentModelFactory {
  constructor(
    private readonly db: AppDatabase,
    private readonly secrets: { get(profileId: string): string | undefined },
    private readonly tools: OpenAiFunctionTool[],
    private readonly fetcher?: typeof fetch
  ) {}

  async create(_signal: AbortSignal) {
    const profile = this.db.listModelProfiles().find(item => item.enabled)
    const apiKey = profile ? this.secrets.get(profile.id) : undefined
    if (!profile || !apiKey) return undefined
    const client = new OpenAiResponsesClient({
      profile,
      apiKey,
      tools: this.tools,
      ...(this.fetcher ? { fetcher: this.fetcher } : {})
    })
    return {
      profile,
      tools: this.tools,
      respond: (input: Parameters<OpenAiResponsesClient['respond']>[0], signal: AbortSignal) => client.respond(input, signal)
    }
  }
}

export class McpRuntimeToolClient implements RuntimeToolClient {
  private constructor(private readonly client: Client, private readonly server?: ReturnType<typeof createLocalMcpServer>) {}

  static async connect(adapter: LocalMcpAdapter): Promise<McpRuntimeToolClient> {
    const server = createLocalMcpServer(adapter)
    const client = new Client({ name: 'cpppilot-agent-host', version: '0.1.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    return new McpRuntimeToolClient(client, server)
  }

  static async connectStdio(parameters: StdioServerParameters, connectTimeoutMs = 5_000): Promise<McpRuntimeToolClient> {
    const client = new Client({ name: 'cpppilot-agent-host', version: '0.1.0' })
    try {
      await client.connect(new StdioClientTransport(parameters), {
        timeout: connectTimeoutMs,
        maxTotalTimeout: connectTimeoutMs
      })
      return new McpRuntimeToolClient(client)
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
  }

  async call(name: string, args: Record<string, unknown>, signal: AbortSignal, onProgress?: (event: RuntimeToolProgress) => void | Promise<void>): Promise<ToolResult> {
    let progressWrites = Promise.resolve()
    const timeoutMs = localToolDefinitions.find(item => item.name === name)?.timeoutMs ?? 60_000
    const response = await this.client.callTool({ name, arguments: args }, undefined, {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
      resetTimeoutOnProgress: true,
      ...(onProgress ? {
        onprogress: progress => {
          progressWrites = progressWrites.then(() => onProgress({
            progress: progress.progress,
            ...(progress.total === undefined ? {} : { total: progress.total }),
            message: progress.message ?? `${name} 正在执行`
          }))
        }
      } : {})
    })
    await progressWrites
    if (!('structuredContent' in response) || !response.structuredContent) {
      return {
        ok: false, exitCode: null, summary: 'MCP 工具未返回结构化结果。', diagnostics: [], artifacts: [],
        sideEffects: [], retryable: false, errorCode: 'MCP_RESULT_INVALID', durationMs: 0
      }
    }
    return toolResultSchema.parse(response.structuredContent)
  }

  async close(): Promise<void> {
    await this.client.close()
    await this.server?.close()
  }
}

interface DesktopMcpAdapterOptions {
  db: AppDatabase
  workspaceService: WorkspaceService
  toolchainService: ToolchainService
  buildRoot: string
  debugSessionFactory?: DebugSessionFactory
}

interface BuildArtifact {
  path: string
  projectId: string
  projectRoot: string
}

interface CmakeArtifact {
  directory: string
  sourceDirectory: string
  projectId: string
  configuration: 'Debug' | 'Release'
}

interface DebugSession {
  initialize(breakpoints: Array<{ path: string; line: number }>): Promise<DebugSessionState>
  execute(command: DebugCommand): Promise<DebugSessionState>
  dispose(): Promise<void>
}

type DebugSessionFactory = (
  sessionId: string,
  debuggerPath: string,
  executablePath: string,
  projectId: string,
  projectRoot: string,
  sourceMappings: ReadonlyMap<string, string>
) => DebugSession

export class DesktopMcpAdapter implements LocalMcpAdapter {
  private readonly artifacts = new Map<string, BuildArtifact>()
  private readonly cmakeArtifacts = new Map<string, CmakeArtifact>()
  private readonly activeRuns = new Map<string, AbortController>()
  private readonly debugSessions = new Map<string, DebugSession>()
  private readonly agentCreatedProjects = new Set<string>()

  constructor(private readonly options: DesktopMcpAdapterOptions) {
    mkdirSync(options.buildRoot, { recursive: true })
  }

  async execute(name: string, args: Record<string, unknown>, context: LocalMcpExecutionContext): Promise<ToolResult> {
    const started = Date.now()
    try {
      const structuredContent = await this.executeStructured(name, args, context)
      const outcome = toolOutcome(name, structuredContent)
      return {
        ok: outcome.ok,
        exitCode: extractExitCode(structuredContent),
        summary: summarize(name, structuredContent),
        structuredContent,
        diagnostics: extractDiagnostics(structuredContent),
        artifacts: extractArtifacts(name, structuredContent),
        sideEffects: sideEffectsFor(name, args),
        retryable: outcome.retryable,
        ...(outcome.errorCode ? { errorCode: outcome.errorCode } : {}),
        durationMs: Date.now() - started
      }
    } catch (error) {
      const toolError = error instanceof ToolExecutionError ? error : undefined
      return {
        ok: false,
        exitCode: null,
        summary: error instanceof Error ? error.message : String(error),
        diagnostics: [],
        artifacts: [],
        sideEffects: [],
        retryable: toolError?.retryable ?? false,
        errorCode: toolError?.code ?? 'MCP_TOOL_FAILED',
        durationMs: Date.now() - started
      }
    }
  }

  async readResource(uri: string): Promise<{ mimeType: string; text: string }> {
    const parsed = new URL(uri)
    const segments = parsed.pathname.split('/').filter(Boolean).map(decodeURIComponent)
    if (parsed.hostname === 'project' && segments[1] === 'tree') {
      return jsonResource(this.options.workspaceService.listTree(segments[0]!))
    }
    if (parsed.hostname === 'project' && segments[1] === 'files') {
      return jsonResource(this.options.workspaceService.readFile(segments[0]!, segments.slice(2).join('/')))
    }
    if (parsed.hostname === 'project' && segments[1] === 'problem') {
      const project = this.options.db.getProject(segments[0]!)
      return jsonResource(project?.problemId ? this.options.db.getProblem(project.problemId) ?? null : null)
    }
    if (parsed.hostname === 'project' && segments[1] === 'diagnostics' && segments[2] === 'latest') {
      const run = this.options.db.listAgentRuns({ projectId: segments[0]!, limit: 1 })[0]
      const detail = run ? this.options.db.getAgentRun(run.id) : undefined
      return jsonResource({
        runId: run?.id ?? null,
        diagnostics: detail?.toolCalls.flatMap(call => call.result?.diagnostics ?? []) ?? []
      })
    }
    if (parsed.hostname === 'learner' && segments[1] === 'knowledge-state') return jsonResource(this.options.db.listLearnerKnowledge(segments[0]!))
    if (parsed.hostname === 'learner' && segments[1] === 'error-book') return jsonResource(this.options.db.listErrorBookEntries(segments[0]!))
    if (parsed.hostname === 'run') return jsonResource(this.options.db.getAgentRun(segments[0]!))
    throw new ToolExecutionError('RESOURCE_NOT_FOUND', `资源不存在：${uri}`, '刷新上下文后重试。')
  }

  private async executeStructured(name: string, args: Record<string, unknown>, context: LocalMcpExecutionContext): Promise<unknown> {
    switch (name) {
      case 'toolchain.detect_compilers': return this.options.toolchainService.detect()
      case 'toolchain.probe_compiler': return this.options.toolchainService.probe(String(args.candidateId))
      case 'toolchain.bind_compiler': {
        const profile = await this.options.toolchainService.bind(String(args.candidateId))
        this.options.db.saveToolchainProfile(profile)
        this.options.db.setActiveToolchain(profile.id)
        const occurredAt = new Date().toISOString()
        this.applyGrowth({
          id: stableUuid(`learning-event:local-user:environment:${profile.id}`),
          sourceEventId: `environment:${profile.id}`,
          userId: 'local-user',
          type: 'environment-ready',
          conceptIds: [],
          xp: 10,
          evidence: { kind: 'build', referenceId: profile.id, summary: `工具链 ${profile.family} ${profile.version} 已通过验证并绑定。` },
          occurredAt
        })
        return profile
      }
      case 'workspace.list_files': return this.options.workspaceService.listTree(String(args.projectId))
      case 'workspace.read_file': return this.options.workspaceService.readFile(String(args.projectId), String(args.relativePath))
      case 'workspace.create_file': {
        const projectId = String(args.projectId)
        const relativePath = String(args.relativePath)
        this.options.workspaceService.createEntry(projectId, relativePath, 'file')
        const document = this.options.workspaceService.readFile(projectId, relativePath)
        return this.options.workspaceService.writeFile(projectId, relativePath, String(args.content ?? ''), document.contentHash, true)
      }
      case 'workspace.apply_patch': return this.options.workspaceService.writeFile(String(args.projectId), String(args.relativePath), String(args.content), String(args.expectedHash), true)
      case 'workspace.create_snapshot': return this.options.workspaceService.createSnapshot(String(args.projectId), String(args.label))
      case 'problem.parse': return parseProblem(String(args.statement))
      case 'project.create': return this.createProject(args)
      case 'compiler.build': return this.build(args, context.signal)
      case 'program.run': return this.run(args, context.signal)
      case 'program.stop': {
        const controller = this.activeRuns.get(String(args.runId))
        controller?.abort()
        return { runId: args.runId, stopped: Boolean(controller) }
      }
      case 'cmake.build': return this.buildCmake(args, context)
      case 'ctest.run': return this.runCtest(args, context)
      case 'analysis.clang_tidy': return this.analyze(args, context)
      case 'vscode.open_file': return this.openInVsCode(args)
      case 'debug.start': return this.startDebug(args, context)
      case 'debug.command': return this.commandDebug(args)
      case 'tests.generate_cases': return generateCases(String(args.statement), Number(args.count ?? 5))
      case 'tests.run_cases': return this.runCases(args, context.signal)
      case 'learning.get_state': {
        const userId = String(args.userId ?? 'local-user')
        const reviewItemId = typeof args.reviewItemId === 'string' ? args.reviewItemId : undefined
        const reviews = this.options.db.listReviewItems(userId, true)
        return {
          knowledge: this.options.db.listLearnerKnowledge(userId),
          errors: this.options.db.listErrorBookEntries(userId),
          reviews: reviewItemId ? reviews.filter(item => item.id === reviewItemId) : reviews
        }
      }
      case 'learning.record_error': return this.recordError(args)
      case 'learning.update_state': return this.updateLearning(args)
      default: throw new ToolExecutionError('MCP_TOOL_NOT_IMPLEMENTED', `工具 ${name} 尚未映射到桌面服务。`, '更新应用后重试。')
    }
  }

  private activeProfile() {
    const id = this.options.db.getSettings().activeToolchainId
    const profile = id ? this.options.db.getToolchainProfile(id) : undefined
    if (!profile) throw new ToolExecutionError('TOOLCHAIN_NOT_BOUND', '尚未绑定可用的 C++ 工具链。', '前往设置页检测并绑定编译器。')
    return profile
  }

  private async build(args: Record<string, unknown>, signal: AbortSignal) {
    const projectId = String(args.projectId)
    const relativePath = String(args.relativePath)
    const { root, workspace } = this.options.workspaceService.projectRoot(projectId)
    if (workspace.trustState !== 'trusted') throw new ToolExecutionError('WORKSPACE_NOT_TRUSTED', '工作区未信任。', '先信任工作区。')
    const buildId = randomUUID()
    const outputDirectory = join(this.options.buildRoot, projectId, buildId)
    const result = await this.options.toolchainService.buildSingleFile({
      profile: this.activeProfile(),
      projectRoot: root,
      sourcePath: safePath(root, relativePath, false),
      sourceRelativePath: relativePath,
      outputDirectory,
      standard: args.standard === 'c++20' || args.standard === 'c++23' ? args.standard : 'c++17',
      signal
    })
    if (result.success) this.artifacts.set(buildId, { path: result.artifactPath, projectId, projectRoot: root })
    if (result.success) {
      const occurredAt = new Date().toISOString()
      this.applyGrowth({
        id: stableUuid(`learning-event:local-user:build:${buildId}`),
        sourceEventId: `build:${buildId}`,
        userId: 'local-user',
        type: 'build-succeeded',
        conceptIds: [],
        xp: 10,
        evidence: { kind: 'build', referenceId: buildId, summary: `${relativePath} 编译通过。` },
        occurredAt
      })
      if (this.agentCreatedProjects.has(projectId)) {
        this.applyGrowth({
          id: stableUuid(`learning-event:local-user:project:${projectId}`),
          sourceEventId: `project:${projectId}`,
          userId: 'local-user',
          type: 'project-completed',
          conceptIds: [],
          xp: 30,
          evidence: { kind: 'build', referenceId: buildId, summary: 'Agent 创建的项目骨架已经通过首次编译。' },
          occurredAt
        })
      }
    }
    return {
      buildId,
      projectId,
      relativePath,
      success: result.success,
      process: result.process,
      diagnostics: result.diagnostics,
      ...(result.success ? { artifactName: result.artifactPath.split(/[\\/]/).at(-1) } : {})
    }
  }

  private async buildCmake(args: Record<string, unknown>, context: LocalMcpExecutionContext) {
    const projectId = String(args.projectId)
    const { root, workspace } = this.options.workspaceService.projectRoot(projectId)
    if (workspace.trustState !== 'trusted') throw new ToolExecutionError('WORKSPACE_NOT_TRUSTED', '工作区未信任。', '先信任工作区。')
    if (!existsSync(join(root, 'CMakeLists.txt'))) throw new ToolExecutionError('CMAKE_PROJECT_REQUIRED', '当前项目根目录没有 CMakeLists.txt。', '选择 CMake 项目，或先创建 CMakeLists.txt。')
    const cmakePath = this.options.toolchainService.resolveToolPath('cmake')
    if (!cmakePath) throw new ToolExecutionError('CMAKE_NOT_FOUND', '未找到 CMake。', '安装 CMake 并重新检测环境。')
    const buildId = randomUUID()
    const buildDirectory = join(this.options.buildRoot, projectId, buildId, 'cmake')
    await context.onProgress(10, 100, '配置 CMake 工程')
    const result = await this.options.toolchainService.buildCmakeProject({
      profile: this.activeProfile(),
      cmakePath,
      projectRoot: root,
      buildDirectory,
      standard: args.standard === 'c++20' || args.standard === 'c++23' ? args.standard : 'c++17',
      configuration: args.configuration === 'Release' ? 'Release' : 'Debug',
      signal: context.signal
    })
    if (result.success) {
      this.cmakeArtifacts.set(buildId, {
        directory: buildDirectory,
        sourceDirectory: result.sourceDirectory,
        projectId,
        configuration: args.configuration === 'Release' ? 'Release' : 'Debug'
      })
    }
    await context.onProgress(100, 100, result.success ? 'CMake 构建完成' : 'CMake 构建失败')
    return {
      buildId,
      projectId,
      profileId: this.activeProfile().id,
      configuration: args.configuration === 'Release' ? 'Release' : 'Debug',
      success: result.success,
      configure: result.configure,
      ...(result.build ? { build: result.build } : {}),
      diagnostics: result.diagnostics,
      compileCommandsGenerated: result.compileCommandsGenerated,
      builtAt: new Date().toISOString()
    }
  }

  private async runCtest(args: Record<string, unknown>, context: LocalMcpExecutionContext) {
    const buildId = String(args.buildId)
    const build = this.cmakeArtifacts.get(buildId)
    if (!build || !existsSync(build.directory)) throw new ToolExecutionError('CTEST_BUILD_NOT_FOUND', 'CMake 构建目录已失效或不存在。', '重新构建 CMake 项目后再运行测试。', true)
    const { workspace } = this.options.workspaceService.projectRoot(build.projectId)
    if (workspace.trustState !== 'trusted') throw new ToolExecutionError('WORKSPACE_NOT_TRUSTED', '工作区未信任。', '先信任工作区。')
    const ctestPath = this.options.toolchainService.resolveToolPath('ctest')
    if (!ctestPath) throw new ToolExecutionError('CTEST_NOT_FOUND', '未找到 CTest。', '安装完整 CMake 工具并重新检测环境。')
    await context.onProgress(20, 100, '运行 CTest')
    const result = await this.options.toolchainService.runCtest({
      ctestPath,
      buildDirectory: build.directory,
      configuration: build.configuration,
      timeoutMs: Number(args.timeoutMs ?? 30_000),
      signal: context.signal
    })
    await context.onProgress(100, 100, 'CTest 完成')
    return { runId: args.runId, buildId, ...result }
  }

  private async analyze(args: Record<string, unknown>, context: LocalMcpExecutionContext) {
    const projectId = String(args.projectId)
    const relativePath = String(args.relativePath)
    const { root, workspace } = this.options.workspaceService.projectRoot(projectId)
    if (workspace.trustState !== 'trusted') throw new ToolExecutionError('WORKSPACE_NOT_TRUSTED', '工作区未信任。', '先信任工作区。')
    if (!/\.(?:cpp|cc|cxx|h|hpp)$/i.test(relativePath)) throw new ToolExecutionError('ANALYSIS_SOURCE_UNSUPPORTED', '当前文件不是可分析的 C++ 文件。', '请选择 C++ 源文件或头文件。')
    const clangTidyPath = this.options.toolchainService.resolveToolPath('clang-tidy')
    if (!clangTidyPath) throw new ToolExecutionError('CLANG_TIDY_NOT_FOUND', '未找到 clang-tidy。', '安装 LLVM 并重新检测环境。')
    const latestBuild = [...this.cmakeArtifacts.values()].reverse().find(item => item.projectId === projectId && existsSync(join(item.directory, 'compile_commands.json')))
    const sourcePath = latestBuild ? safePath(latestBuild.sourceDirectory, relativePath, false) : safePath(root, relativePath, false)
    await context.onProgress(20, 100, '执行 clang-tidy')
    const result = await this.options.toolchainService.analyzeWithClangTidy({
      clangTidyPath,
      profile: this.activeProfile(),
      projectRoot: latestBuild?.sourceDirectory ?? root,
      sourcePath,
      standard: args.standard === 'c++20' || args.standard === 'c++23' ? args.standard : 'c++17',
      ...(latestBuild ? { compileCommandsDirectory: latestBuild.directory } : {}),
      signal: context.signal
    })
    await context.onProgress(100, 100, '静态分析完成')
    return { runId: args.runId, projectId, relativePath, ...result, analyzedAt: new Date().toISOString() }
  }

  private async openInVsCode(args: Record<string, unknown>) {
    const projectId = String(args.projectId)
    const { root } = this.options.workspaceService.projectRoot(projectId)
    const vscodePath = this.options.toolchainService.resolveToolPath('vscode')
    if (!vscodePath) throw new ToolExecutionError('VSCODE_NOT_FOUND', '未找到 VS Code 命令行工具。', '安装 VS Code 并重新检测环境。')
    const relativePath = typeof args.relativePath === 'string' ? args.relativePath : undefined
    const targetPath = relativePath ? safePath(root, relativePath, false) : undefined
    const process = await this.options.toolchainService.openInVsCode(vscodePath, root, targetPath ? {
      path: targetPath,
      ...(typeof args.line === 'number' ? { line: args.line } : {}),
      ...(typeof args.column === 'number' ? { column: args.column } : {})
    } : undefined)
    return { success: process.exitCode === 0 && !process.timedOut && !process.cancelled, process }
  }

  private async startDebug(args: Record<string, unknown>, context: LocalMcpExecutionContext) {
    const projectId = String(args.projectId)
    const relativePath = String(args.relativePath)
    const { root, workspace } = this.options.workspaceService.projectRoot(projectId)
    if (workspace.trustState !== 'trusted') throw new ToolExecutionError('WORKSPACE_NOT_TRUSTED', '工作区未信任。', '先信任工作区。')
    if (!/\.(?:cpp|cc|cxx)$/i.test(relativePath)) throw new ToolExecutionError('DEBUG_SOURCE_UNSUPPORTED', '当前文件不是可调试的 C++ 源文件。', '请选择 C++ 源文件。')
    const profile = this.activeProfile()
    if (!profile.debuggerPath || !existsSync(profile.debuggerPath)) throw new ToolExecutionError('DEBUGGER_NOT_FOUND', '当前工具链没有可用调试器。', '安装 GDB 并重新绑定工具链。')
    if (profile.family === 'msvc') throw new ToolExecutionError('DEBUGGER_BACKEND_UNSUPPORTED', '当前版本尚未接入 MSVC 调试后端。', '选择带 GDB 的 GCC 工具链。')
    const sessionId = randomUUID()
    const outputDirectory = join(this.options.buildRoot, projectId, sessionId, 'debug')
    const stagedSourcePath = join(outputDirectory, 'debug-source.cpp')
    mkdirSync(outputDirectory, { recursive: true })
    copyFileSync(safePath(root, relativePath, false), stagedSourcePath)
    await context.onProgress(20, 100, '构建调试程序')
    const build = await this.options.toolchainService.buildSingleFile({
      profile,
      projectRoot: root,
      sourcePath: stagedSourcePath,
      sourceRelativePath: relativePath,
      outputDirectory,
      standard: args.standard === 'c++20' || args.standard === 'c++23' ? args.standard : 'c++17',
      debugSymbols: true,
      includeDirectories: [root],
      signal: context.signal
    })
    if (!build.success) return { sessionId, projectId, status: 'error', reason: '调试构建失败。', frames: [], variables: [], output: `${build.process.stdout}\n${build.process.stderr}`.trim(), diagnostics: build.diagnostics }
    const factory = this.options.debugSessionFactory ?? ((...factoryArgs) => new GdbMiSession(...factoryArgs))
    const session = factory(sessionId, profile.debuggerPath, build.artifactPath, projectId, root, new Map([[stagedSourcePath, relativePath]]))
    this.debugSessions.set(sessionId, session)
    try {
      const breakpoints = Array.isArray(args.breakpoints) ? args.breakpoints as Array<{ relativePath: string; line: number }> : []
      const state = await session.initialize(breakpoints
        .filter(item => item.relativePath.replaceAll('\\', '/').toLowerCase() === relativePath.replaceAll('\\', '/').toLowerCase())
        .map(item => ({ path: stagedSourcePath.replaceAll('\\', '/'), line: item.line })))
      await context.onProgress(100, 100, '调试会话已启动')
      return state
    } catch (error) {
      this.debugSessions.delete(sessionId)
      await session.dispose()
      throw error
    }
  }

  private async commandDebug(args: Record<string, unknown>) {
    const sessionId = String(args.sessionId)
    const session = this.debugSessions.get(sessionId)
    if (!session) throw new ToolExecutionError('DEBUG_SESSION_NOT_FOUND', '调试会话不存在或已结束。', '重新启动调试。', true)
    const state = await session.execute(args.command as DebugCommand)
    if (state.status === 'exited' || state.status === 'error') {
      await session.dispose()
      this.debugSessions.delete(sessionId)
    }
    return state
  }

  private async run(args: Record<string, unknown>, signal: AbortSignal) {
    const buildId = String(args.buildId)
    const artifact = this.artifacts.get(buildId)
    if (!artifact || !existsSync(artifact.path)) throw new ToolExecutionError('RUN_BUILD_NOT_FOUND', '编译产物不存在。', '重新编译后运行。', true)
    const process = await runProcess(artifact.path, [], {
      cwd: artifact.projectRoot,
      input: String(args.input ?? ''),
      timeoutMs: Number(args.timeoutMs ?? 5_000),
      maxOutputBytes: 512 * 1024,
      signal
    })
    return { runId: args.runId, buildId, success: process.exitCode === 0 && !process.timedOut && !process.cancelled, process, diagnostics: runtimeDiagnostics(process) }
  }

  private createProject(args: Record<string, unknown>) {
    const workspace = this.options.db.listWorkspaces().find(item => item.trustState === 'trusted')
    if (!workspace) throw new ToolExecutionError('WORKSPACE_NOT_AVAILABLE', '没有已信任工作区。', '先在设置中添加并信任工作区。')
    const draft = this.options.workspaceService.previewProject({
      mode: 'description', workspaceId: workspace.id, name: String(args.name), type: 'single-file', description: String(args.description)
    })
    const project = this.options.workspaceService.commitDraft(draft.draftId)
    this.agentCreatedProjects.add(project.id)
    return { projectId: project.id, relativePath: 'main.cpp', project }
  }

  private async runCases(args: Record<string, unknown>, signal: AbortSignal) {
    const build = await this.build(args, signal) as { buildId: string; success: boolean; diagnostics: unknown[] }
    if (!build.success) return { passed: false, total: 0, passedCount: 0, failedCount: 0, build }
    const cases = Array.isArray(args.cases) ? args.cases as Array<{ input?: unknown; expectedOutput?: unknown }> : []
    const results = []
    for (const item of cases) {
      const run = await this.run({ runId: args.runId, buildId: build.buildId, input: String(item.input ?? ''), timeoutMs: 5_000 }, signal) as { process: { stdout: string }; success: boolean }
      const actual = run.process.stdout.trim().replace(/\r\n/g, '\n')
      const expected = String(item.expectedOutput ?? '').trim().replace(/\r\n/g, '\n')
      results.push({ input: String(item.input ?? ''), expectedOutput: expected, actualOutput: actual, passed: run.success && actual === expected })
    }
    const passedCount = results.filter(item => item.passed).length
    const passed = results.length > 0 && passedCount === results.length
    return { passed, total: results.length, passedCount, failedCount: results.length - passedCount, results, buildId: build.buildId }
  }

  private updateLearning(args: Record<string, unknown>) {
    return this.options.db.transaction(() => this.updateLearningTransaction(args))
  }

  private updateLearningTransaction(args: Record<string, unknown>) {
    const now = new Date().toISOString()
    const userId = String(args.userId ?? 'local-user')
    const conceptId = String(args.conceptId)
    const reviewItemId = typeof args.reviewItemId === 'string' ? args.reviewItemId : undefined
    const review = reviewItemId
      ? this.options.db.listReviewItems(userId).find(item => item.id === reviewItemId)
      : undefined
    const reviewOutcome = args.reviewOutcome === 'passed' || args.reviewOutcome === 'failed' ? args.reviewOutcome : undefined
    if (reviewItemId && (!review || review.conceptId !== conceptId || review.status !== 'pending')) {
      throw new ToolExecutionError('REVIEW_EVIDENCE_INVALID', '复习验证证据无效或已经使用。', '从当前到期复习项重新开始。')
    }
    if (args.status === 'verified' && (!review || reviewOutcome !== 'passed')) {
      throw new ToolExecutionError('REVIEW_EVIDENCE_INVALID', '已验证状态需要通过的复习证据。', '完成当前复习并确认结果。')
    }
    if (reviewOutcome === 'failed' && (!review || args.status !== 'review')) {
      throw new ToolExecutionError('REVIEW_EVIDENCE_INVALID', '失败复习必须把知识状态设为待复习。', '重新提交当前复习结果。')
    }
    const state: LearnerKnowledge = {
      userId,
      conceptId,
      status: args.status as LearnerKnowledge['status'],
      confidence: args.status === 'verified' ? 1 : 0.6,
      ...(args.status === 'verified' ? { verifiedAt: now } : {}),
      lastEvidenceId: String(args.evidenceId),
      updatedAt: now
    }
    this.options.db.upsertLearnerKnowledge(state)
    const evidenceId = String(args.evidenceId)
    if (review && reviewOutcome) {
      if (reviewOutcome === 'failed') {
        this.options.db.saveReviewItem({
          ...review,
          intervalIndex: 0,
          dueAt: nextReviewDate(new Date(now), 0).toISOString(),
          status: 'pending'
        })
      } else {
        const isFinalInterval = review.intervalIndex >= reviewIntervalsDays.length - 1
        this.options.db.saveReviewItem(isFinalInterval
          ? { ...review, status: 'completed', completedAt: now }
          : {
              ...review,
              intervalIndex: review.intervalIndex + 1,
              dueAt: nextReviewDate(new Date(now), review.intervalIndex + 1).toISOString(),
              status: 'pending'
            })
      }
    }
    return { state, summary: this.options.db.getLearnerSummary(state.userId) }
  }

  private recordError(args: Record<string, unknown>) {
    return this.options.db.transaction(() => this.recordErrorTransaction(args))
  }

  private recordErrorTransaction(args: Record<string, unknown>) {
    const now = new Date()
    const userId = String(args.userId ?? 'local-user')
    const evidenceId = String(args.evidenceId)
    const id = stableUuid(`learning-error:${userId}:${evidenceId}`)
    const conceptIds = Array.isArray(args.conceptIds) ? args.conceptIds.map(String) : []
    const status = args.status === 'open' ? 'open' as const : 'resolved' as const
    const entry = this.options.db.saveErrorBookEntry({
      id,
      userId,
      ...(args.projectId ? { projectId: String(args.projectId) } : {}),
      ...(args.relativePath ? { relativePath: String(args.relativePath) } : {}),
      category: args.category as 'compile' | 'linker' | 'runtime' | 'logic' | 'analysis' | 'debug',
      title: String(args.title),
      evidence: String(args.evidence),
      conceptIds,
      status,
      occurrences: 1,
      firstSeenAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      ...(status === 'resolved' ? { resolvedAt: now.toISOString() } : {})
    })
    return { entry, summary: this.options.db.getLearnerSummary(entry.userId) }
  }

  private applyGrowth(event: Parameters<AppDatabase['applyLearningEvent']>[0]): boolean {
    // Historical learning tables remain readable, but assistant work no longer writes scores, badges, or review progress.
    void event
    return false
  }
}

function parseProblem(statement: string) {
  const samples = [...statement.matchAll(/输入[:：]\s*([^\n]+)[\s\S]*?输出[:：]\s*([^\n]+)/g)].map(match => ({ input: match[1]?.trim() ?? '', output: match[2]?.trim() ?? '' }))
  return { statement, constraints: statement.split(/\r?\n/).filter(line => /限制|范围|<=|≥|≤/.test(line)).slice(0, 20), samples }
}

function generateCases(statement: string, count: number) {
  const parsed = parseProblem(statement)
  const cases = parsed.samples.map(item => ({ input: item.input, expectedOutput: item.output }))
  while (cases.length < Math.max(1, count)) cases.push({ input: String(cases.length), expectedOutput: '' })
  return { cases: cases.slice(0, count), source: parsed.samples.length ? 'statement-samples' : 'deterministic-boundaries' }
}

function jsonResource(value: unknown) { return { mimeType: 'application/json', text: JSON.stringify(value) } }
function stableUuid(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32)
  const variant = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
function extractDiagnostics(value: unknown) { return value && typeof value === 'object' && Array.isArray((value as any).diagnostics) ? (value as any).diagnostics : [] }
function extractExitCode(value: unknown): number | null {
  if (!value || typeof value !== 'object') return 0
  const process = (value as any).process
  return typeof process?.exitCode === 'number' ? process.exitCode : 0
}
function toolOutcome(name: string, value: unknown): { ok: boolean; retryable: boolean; errorCode?: string } {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const outcomes: Record<string, { field: string; errorCode: string; retryable?: boolean }> = {
    'toolchain.probe_compiler': { field: 'success', errorCode: 'TOOLCHAIN_PROBE_FAILED' },
    'compiler.build': { field: 'success', errorCode: 'BUILD_FAILED' },
    'program.run': { field: 'success', errorCode: 'PROGRAM_RUN_FAILED', retryable: true },
    'cmake.build': { field: 'success', errorCode: 'CMAKE_BUILD_FAILED' },
    'ctest.run': { field: 'success', errorCode: 'CTEST_FAILED' },
    'analysis.clang_tidy': { field: 'success', errorCode: 'ANALYSIS_FAILED' },
    'vscode.open_file': { field: 'success', errorCode: 'VSCODE_OPEN_FAILED', retryable: true },
    'tests.run_cases': { field: 'passed', errorCode: 'TEST_CASES_FAILED' }
  }
  const definition = outcomes[name]
  if (name === 'debug.start') {
    const ok = record.status !== 'error'
    return ok ? { ok: true, retryable: false } : { ok: false, retryable: false, errorCode: 'DEBUG_START_FAILED' }
  }
  if (!definition || typeof record[definition.field] !== 'boolean') return { ok: true, retryable: false }
  return record[definition.field]
    ? { ok: true, retryable: false }
    : { ok: false, retryable: definition.retryable ?? false, errorCode: definition.errorCode }
}
function summarize(name: string, value: unknown): string {
  if (value && typeof value === 'object') {
    if ('success' in value) return (value as any).success ? `${name} 成功。` : `${name} 返回失败证据。`
    if ('passed' in value) return (value as any).passed ? `${name} 全部通过。` : `${name} 发现失败用例。`
  }
  return `${name} 完成。`
}
function extractArtifacts(name: string, value: unknown) {
  if (name === 'compiler.build' && value && typeof value === 'object' && (value as any).buildId) return [{ id: String((value as any).buildId), kind: 'build' as const, label: String((value as any).artifactName ?? 'build') }]
  return []
}
function sideEffectsFor(name: string, args: Record<string, unknown>) {
  if (name === 'workspace.apply_patch' || name === 'workspace.create_file') return [{ kind: 'write-file' as const, target: String(args.relativePath), summary: '修改项目文件' }]
  if (name === 'project.create') return [{ kind: 'create-file' as const, target: String(args.name), summary: '创建学习项目' }, { kind: 'persist-state' as const, target: 'projects', summary: '登记项目' }]
  if (name === 'program.run' || name === 'tests.run_cases') return [{ kind: 'run-program' as const, target: String(args.projectId ?? args.buildId ?? 'program'), summary: '运行用户程序' }]
  if (name === 'learning.update_state' || name === 'learning.record_error' || name === 'toolchain.bind_compiler') return [{ kind: 'persist-state' as const, target: name, summary: '更新本地状态' }]
  return []
}
