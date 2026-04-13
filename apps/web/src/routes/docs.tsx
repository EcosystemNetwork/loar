import { createFileRoute, Link } from '@tanstack/react-router';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Database,
  Globe,
  Server,
  FileCode,
  Layers,
  Shield,
  Cpu,
  Box,
  GitBranch,
  Blocks,
  Wallet,
  Vote,
  Video,
  Upload,
  Key,
  Network,
} from 'lucide-react';

export const Route = createFileRoute('/docs')({
  component: DocsPage,
});

function Section({
  id,
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  id: string;
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-6 py-4 bg-card hover:bg-card/80 transition-colors text-left"
      >
        <Icon className="h-5 w-5 text-primary shrink-0" />
        <h2 className="text-lg font-semibold flex-1">{title}</h2>
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-6 py-5 space-y-4 text-sm leading-relaxed text-muted-foreground">
          {children}
        </div>
      )}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">
      {children}
    </code>
  );
}

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      {title && (
        <div className="bg-muted/50 px-4 py-2 border-b border-border text-xs font-mono text-muted-foreground">
          {title}
        </div>
      )}
      <pre className="bg-muted/30 p-4 overflow-x-auto text-xs font-mono leading-relaxed">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/50">
            {headers.map((h) => (
              <th
                key={h}
                className="text-left px-4 py-2 font-semibold text-foreground border-b border-border"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
              {row.map((cell, j) => (
                <td key={j} className="px-4 py-2 font-mono">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NAV_ITEMS = [
  { id: 'overview', label: 'Overview' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'frontend', label: 'Frontend (Web)' },
  { id: 'backend', label: 'Backend (Server)' },
  { id: 'contracts', label: 'Smart Contracts' },
  { id: 'indexer', label: 'Blockchain Indexer' },
  { id: 'storage', label: 'Storage Layer' },
  { id: 'auth', label: 'Authentication' },
  { id: 'ai', label: 'AI Services' },
  { id: 'governance', label: 'Governance Lifecycle' },
  { id: 'admin-permissions', label: 'Admin Permissions' },
  { id: 'trust-model', label: 'Trust Model' },
  { id: 'canon-integrity', label: 'Canon Integrity' },
  { id: 'token-economics', label: 'Token Economics' },
  { id: 'contract-release', label: 'Contract Release' },
  { id: 'api', label: 'API Reference' },
  { id: 'env', label: 'Environment Variables' },
  { id: 'deployment', label: 'Deployment' },
];

function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 flex gap-8">
        {/* Sidebar Navigation */}
        <aside className="hidden lg:block w-56 shrink-0">
          <nav className="sticky top-24 space-y-1">
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider">
              Documentation
            </p>
            {NAV_ITEMS.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="block px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md transition-colors"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 min-w-0 max-w-4xl space-y-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold mb-2">LOAR Documentation</h1>
            <p className="text-muted-foreground">
              Complete technical documentation for the LOAR Decentralized Narrative Control Suite.
            </p>
          </div>

          {/* Overview */}
          <Section id="overview" title="Overview" icon={Globe} defaultOpen>
            <p>
              <strong className="text-foreground">LOAR</strong> is a decentralized narrative control
              suite that combines Web3 blockchain governance, AI-powered content generation, and
              decentralized storage to enable collaborative storytelling at scale.
            </p>
            <p>
              Users create <strong className="text-foreground">Cinematic Universes</strong> &mdash;
              on-chain narrative containers where communities collaboratively build stories through
              video nodes, governance proposals, and tokenized participation.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              {[
                ['Cinematic Universes', 'On-chain narrative containers with branching storylines'],
                ['AI Generation', 'Text-to-image and text-to-video via FAL, Veo3, Kling, and more'],
                ['Token Governance', 'ERC20 governance tokens with proposal voting per universe'],
                [
                  'Decentralized Storage',
                  'Multi-provider (Pinata, Lighthouse, Storacha, Firebase) with fallback',
                ],
                ['Uniswap v4 Hooks', 'Custom liquidity hooks for tokenized narratives'],
                ['Blockchain Indexing', 'Real-time event indexing with Ponder + GraphQL API'],
              ].map(([title, desc]) => (
                <div key={title} className="border border-border rounded-md p-3 bg-card/50">
                  <p className="text-foreground font-medium text-sm">{title}</p>
                  <p className="text-xs mt-1">{desc}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Architecture */}
          <Section id="architecture" title="Architecture" icon={Layers}>
            <p>
              LOAR is a <strong className="text-foreground">Turborepo monorepo</strong> using{' '}
              <Code>pnpm@9.15.0</Code> workspaces with four apps and one shared package:
            </p>
            <CodeBlock title="Monorepo Structure">{`loar/
├── apps/
│   ├── web/          # React 18 + Vite frontend
│   ├── server/       # Hono + tRPC backend API
│   ├── indexer/      # Ponder blockchain event indexer
│   └── contracts/    # Foundry/Solidity smart contracts
├── packages/
│   └── abis/         # Shared contract ABIs & generated hooks
├── turbo.json        # Task orchestration
├── .env              # Centralized environment variables
└── docker-compose.yml`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Data Flow</h3>
            <CodeBlock>{`User (Browser)
  │
  ├─► Frontend (React + Wagmi) ──► Wallet (Dynamic Labs)
  │     │                                    │
  │     ├─► tRPC Client ──────────► Server (Hono + tRPC)
  │     │                              │
  │     │                              ├─► Firebase (Auth + Firestore)
  │     │                              ├─► FAL / Gemini / OpenAI (AI)
  │     │                              └─► Storage Manager
  │     │                                    ├─► Pinata (IPFS)
  │     │                                    ├─► Lighthouse (Filecoin)
  │     │                                    ├─► Storacha (Archive)
  │     │                                    └─► Firebase Storage
  │     │
  │     └─► Ponder GraphQL ────────► Indexer (Ponder)
  │                                      │
  └─► Smart Contracts (Sepolia) ◄────────┘
        ├─► UniverseManager (factory)
        ├─► Universe (narrative nodes)
        ├─► UniverseGovernor (proposals)
        ├─► GovernanceERC20 (voting tokens)
        └─► LoarHook (Uniswap v4)`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Tech Stack</h3>
            <Table
              headers={['Layer', 'Technology']}
              rows={[
                [
                  'Frontend',
                  'React 18, Vite 6, TailwindCSS v4, TanStack Router/Query, Wagmi, Dynamic Labs',
                ],
                ['Backend', 'Hono, tRPC, Firebase Admin, Node.js 20'],
                ['Contracts', 'Solidity 0.8.30+, Foundry, OpenZeppelin, Uniswap v4'],
                ['Indexer', 'Ponder v0.15, PostgreSQL, GraphQL'],
                ['Storage', 'Pinata (IPFS), Lighthouse (Filecoin), Storacha, Firebase Storage'],
                ['AI', 'FAL (Flux, Veo3, Kling, Wan25, Sora), Google Gemini, OpenAI'],
                ['Auth', 'SIWE (Sign-In with Ethereum) + JWT sessions'],
                ['Database', 'Firebase Firestore'],
                ['Infra', 'Docker, Turborepo, pnpm workspaces'],
              ]}
            />
          </Section>

          {/* Frontend */}
          <Section id="frontend" title="Frontend (apps/web)" icon={Globe}>
            <p>
              The frontend is a single-page app built with{' '}
              <strong className="text-foreground">React 18</strong> and
              <strong className="text-foreground"> Vite 6</strong>, using file-based routing via
              TanStack Router.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Routes</h3>
            <Table
              headers={['Path', 'Component', 'Description']}
              rows={[
                [
                  '/',
                  'HomeComponent',
                  'Landing page with universe explorer, activity feed, trending tokens',
                ],
                ['/login', 'LoginPage', 'Dynamic Labs wallet connection (EVM) with SIWE sign-in'],
                [
                  '/dashboard',
                  'Dashboard',
                  'User dashboard with universes list and AI media generation',
                ],
                [
                  '/cinematicUniverseCreate',
                  'CreateUniverse',
                  'Multi-step universe creation wizard',
                ],
                [
                  '/universe/:id',
                  'UniverseView',
                  'Universe detail with timeline, nodes, and governance',
                ],
                [
                  '/event/:universe/:event',
                  'EventViewer',
                  'Individual narrative event/node viewer',
                ],
                ['/market', 'Market', 'Token marketplace and trading interface'],
                ['/docs', 'DocsPage', 'This documentation page'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Key Components</h3>
            <Table
              headers={['Component', 'Purpose']}
              rows={[
                [
                  'DirectUpload',
                  'Drag-and-drop file upload (multipart, bypasses tRPC for large files)',
                ],
                ['EventCreationSidebar', 'Timeline event creation with narrative options'],
                ['FlowCreationPanel', 'Visual flow editor using ReactFlow for narrative sequences'],
                ['SceneEditor / SceneBuilder', 'Visual scene composition and editing tools'],
                ['GenerativeMedia', 'AI image/video generation UI with model selection'],
                ['GovernanceSidebar', 'Governance proposal creation and voting interface'],
                ['WalletConnectButton', 'Dynamic Labs wallet connection widget'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Custom Hooks</h3>
            <Table
              headers={['Hook', 'Purpose']}
              rows={[
                [
                  'useCharacterGeneration',
                  'AI image generation for characters (Flux, Nano Banana models)',
                ],
                [
                  'useVideoGeneration',
                  'Video generation via FAL (Veo3, Kling, Wan25, Sora, RunwayGen3)',
                ],
                [
                  'useContractSave',
                  'Blockchain write operations (create node with content/plot hashes)',
                ],
                ['useUniverseBlockchain', 'Universe contract read/write calls'],
                ['useUniverseGovernor', 'Governance proposal creation and voting'],
                ['useUniverseManager', 'Universe factory interactions'],
                ['useUploadQueue', 'Async file upload queuing and status polling'],
                ['useTimeline', 'Timeline state management for narrative flows'],
                ['useSegments', 'Scene segment management'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">State Management</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong className="text-foreground">Server state:</strong> TanStack Query via tRPC
                client &mdash; auto-caching, invalidation, optimistic updates
              </li>
              <li>
                <strong className="text-foreground">Blockchain state:</strong> Ponder GraphQL
                queries via <Code>ponderGql()</Code> utility + React Query
              </li>
              <li>
                <strong className="text-foreground">Wallet state:</strong> Wagmi hooks (
                <Code>useAccount</Code>, <Code>useWriteContract</Code>, etc.)
              </li>
              <li>
                <strong className="text-foreground">Auth state:</strong>{' '}
                <Code>useWalletAuth()</Code> hook backed by Dynamic Labs + SIWE
              </li>
            </ul>
          </Section>

          {/* Backend */}
          <Section id="backend" title="Backend (apps/server)" icon={Server}>
            <p>
              The server is a <strong className="text-foreground">Hono</strong> HTTP framework with{' '}
              <strong className="text-foreground">tRPC</strong> for type-safe RPC, running on
              Node.js 20.
            </p>

            <h3 className="text-foreground font-semibold mt-4">HTTP Endpoints</h3>
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/', 'Status endpoint'],
                ['GET', '/health', 'Health check'],
                [
                  'POST',
                  '/api/upload',
                  'Direct multipart file upload (up to 200MB, auth required)',
                ],
                ['ALL', '/trpc/*', 'tRPC router (all procedures)'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">tRPC Routers</h3>

            <h4 className="text-foreground font-medium mt-3">universes</h4>
            <Table
              headers={['Procedure', 'Type', 'Description']}
              rows={[
                [
                  'createcu',
                  'mutation',
                  'Create universe (requires wallet signature with 5-min timestamp window)',
                ],
                ['get', 'query', 'Fetch universe by ID'],
                ['getAll', 'query', 'List all universes'],
                ['getByCreator', 'query', 'Filter universes by creator wallet address'],
              ]}
            />

            <h4 className="text-foreground font-medium mt-3">fal (AI Generation)</h4>
            <Table
              headers={['Procedure', 'Type', 'Description']}
              rows={[
                ['generateImage', 'mutation', 'Text-to-image (Flux, Nano Banana models)'],
                ['imageToImage', 'mutation', 'Image-to-image editing/composition'],
                [
                  'generateVideo',
                  'mutation',
                  'Text/image-to-video (Veo3, Kling, Wan25, Sora, RunwayGen3)',
                ],
                ['veo3ImageToVideo', 'mutation', 'Veo3-specific image-to-video wrapper'],
              ]}
            />

            <h4 className="text-foreground font-medium mt-3">storage</h4>
            <Table
              headers={['Procedure', 'Type', 'Description']}
              rows={[
                ['upload', 'mutation', 'Upload from URL, returns manifest with content hash'],
                ['uploadDirect', 'mutation', 'Base64 upload via tRPC'],
                ['resolve', 'query', 'Resolve contentHash to best available URL'],
                ['getManifest', 'query', 'Get full storage manifest for a content hash'],
                ['uploadAsync', 'mutation', 'Enqueue async upload, returns jobId'],
                ['uploadStatus', 'query', 'Poll async upload job status'],
                ['activeUploads', 'query', "List user's active upload jobs"],
                ['recentUploads', 'query', "List user's recent upload history"],
              ]}
            />

            <h4 className="text-foreground font-medium mt-3">wiki</h4>
            <Table
              headers={['Procedure', 'Type', 'Description']}
              rows={[
                ['characters', 'query', 'List all characters'],
                ['character', 'query', 'Get single character by ID'],
                ['generateEventWikia', 'mutation', 'AI-generated wiki entry for a narrative event'],
                ['generateStoryline', 'mutation', 'AI storyline generation from prompt'],
                ['generateFromVideo', 'mutation', 'Extract wiki content from video using Gemini'],
                ['improveVideoPrompt', 'mutation', 'AI prompt refinement with universe context'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Middleware</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong className="text-foreground">CORS</strong> &mdash; Configurable origin via{' '}
                <Code>CORS_ORIGIN</Code>
              </li>
              <li>
                <strong className="text-foreground">Rate Limiting</strong> &mdash; 100 requests/min
                per IP
              </li>
              <li>
                <strong className="text-foreground">Security Headers</strong> &mdash; Standard
                security headers (CSP, XSS, etc.)
              </li>
              <li>
                <strong className="text-foreground">Error Handler</strong> &mdash; Dev/prod modes
                with stack traces in dev
              </li>
              <li>
                <strong className="text-foreground">Logger</strong> &mdash; Request logging
              </li>
            </ul>
          </Section>

          {/* Smart Contracts */}
          <Section id="contracts" title="Smart Contracts (apps/contracts)" icon={FileCode}>
            <p>
              Solidity smart contracts built with{' '}
              <strong className="text-foreground">Foundry</strong> (v0.8.30+), deployed on{' '}
              <strong className="text-foreground">Ethereum Sepolia</strong> testnet.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Contracts</h3>

            <h4 className="text-foreground font-medium mt-3">UniverseManager (Factory)</h4>
            <p>
              The entry point for the LOAR protocol. Creates Universe contracts, deploys governance
              tokens, enables hooks and lockers, and manages team fee collection.
            </p>
            <CodeBlock title="Key Functions">{`createUniverse(name, description, image, ...) → address
deployToken(name, symbol, image, context) → (token, governor)
enableHook(universe, hook) / enableLocker(universe, locker)
getUniverse(address) → UniverseData`}</CodeBlock>

            <h4 className="text-foreground font-medium mt-3">Universe (Narrative Container)</h4>
            <p>
              Each universe is a separate contract storing a linked list of <Code>VideoNode</Code>{' '}
              structs. Nodes contain content and plot hashes (SHA-256, stored as{' '}
              <Code>bytes32</Code> for gas efficiency).
            </p>
            <CodeBlock title="VideoNode Structure">{`struct VideoNode {
    bytes32 contentHash;   // SHA-256 of media content
    bytes32 plotHash;      // SHA-256 of plot/narrative text
    uint256 previous;      // Link to parent node
    uint256 next;          // Link to next node
    bool canon;            // Approved by governance
    address creator;       // Node author
}`}</CodeBlock>

            <h4 className="text-foreground font-medium mt-3">UniverseGovernor</h4>
            <p>OpenZeppelin Governor pattern. Each universe gets its own governor instance.</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Voting delay: 0 (immediate)</li>
              <li>Voting period: 1 hour</li>
              <li>Proposal threshold: 1e18 tokens</li>
              <li>Quorum: 10% of total supply</li>
            </ul>

            <h4 className="text-foreground font-medium mt-3">GovernanceERC20</h4>
            <p>
              ERC20 token with voting capabilities (ERC20Votes). Each universe can deploy its own
              token. Includes metadata fields for name, symbol, image URL, and context string.
            </p>

            <h4 className="text-foreground font-medium mt-3">LoarHook (Uniswap v4)</h4>
            <p>
              Custom Uniswap v4 hook for tokenized narrative universes. Handles LP fee logic,
              protocol fees, and factory pattern for pool creation.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Deployed Addresses (Sepolia)</h3>
            <Table
              headers={['Contract', 'Address']}
              rows={[
                ['UniverseManager', '0x66F289658Ce5fD0Bb1022251eA4604F6b0C4d7Ce'],
                ['UniverseTokenDeployer', '0xa2556B55C834504b2d71ECa8D1c1295e19D31BEf'],
                ['LoarFeeLocker', '0x1E10b62bd2817d0C2414909027E1E63653fcCd8e'],
                ['LoarLpLockerMultiple', '0xc00225D9463C15280748dC2E21D8D8625982Ad54'],
                ['LoarHookStaticFee', '0x9A53B31b8B4F76Bb617D6B9aAd62731f8033A8Cc'],
              ]}
            />
          </Section>

          {/* Indexer */}
          <Section id="indexer" title="Blockchain Indexer (apps/indexer)" icon={Blocks}>
            <p>
              <strong className="text-foreground">Ponder v0.15</strong> indexes smart contract
              events in real-time from Sepolia into a PostgreSQL database, exposing a GraphQL API on
              port <Code>42069</Code>.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Indexed Contracts & Events</h3>
            <Table
              headers={['Contract', 'Events']}
              rows={[
                ['UniverseManager', 'UniverseCreated, TokenCreated, SetHook'],
                ['Universe (dynamic)', 'NodeCreated, NodeCanonized'],
                [
                  'UniverseGovernor (dynamic)',
                  'ProposalCreated, ProposalExecuted, ProposalCanceled, VoteCast',
                ],
                ['GovernanceToken (dynamic)', 'Transfer'],
                ['PoolManager (Uniswap v4)', 'Initialize, Swap'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Database Schema</h3>
            <Table
              headers={['Table', 'Description']}
              rows={[
                [
                  'universe',
                  'Universe metadata (name, description, image, node count, token/governor addresses)',
                ],
                ['token', 'Governance token info (name, symbol, supply, admin, pool details)'],
                ['node', 'Narrative nodes (content hash, plot hash, creator, parent link)'],
                ['nodeContent', 'Full content strings (video URLs, plot text from events)'],
                ['nodeCanonization', 'Node approval/canonization records'],
                ['proposal', 'Governance proposals (targets, values, description, vote period)'],
                ['vote', 'Individual votes cast on proposals'],
                ['tokenHolder', 'Current token holder balances'],
                ['tokenTransfer', 'Token transfer history'],
                ['pool', 'Uniswap v4 liquidity pools'],
                ['swap', 'Pool swap records'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">GraphQL Usage</h3>
            <CodeBlock title="Example Query">{`// Frontend uses ponderGql() utility
const { universes } = await ponderGql(\`{
  universes(orderBy: "createdAt", orderDirection: "desc", limit: 10) {
    items {
      id name description image nodeCount
      tokenAddress governorAddress
    }
  }
}\`);`}</CodeBlock>
          </Section>

          {/* Storage Layer */}
          <Section id="storage" title="Decentralized Storage Layer" icon={Upload}>
            <p>
              LOAR uses a <strong className="text-foreground">unified storage manager</strong> with
              priority-based provider fallback and background redundancy. Content is identified by
              SHA-256 hash and stored across multiple providers for resilience.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Storage Providers</h3>
            <Table
              headers={['Provider', 'Network', 'Use Case']}
              rows={[
                [
                  'Pinata',
                  'IPFS network',
                  'Hot storage and public content delivery (highest priority)',
                ],
                ['Lighthouse', 'Filecoin', 'Permanent storage with token-gated encryption'],
                ['Storacha', 'IPFS + Filecoin', 'Redundancy and archival storage'],
                ['Firebase Storage', 'Google Cloud', 'Fast fallback for availability'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">How It Works</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                <strong className="text-foreground">Upload:</strong> Content is hashed (SHA-256) and
                uploaded to the highest-priority available provider
              </li>
              <li>
                <strong className="text-foreground">Manifest:</strong> A storage manifest is saved
                to Firestore mapping the content hash to provider-specific identifiers
              </li>
              <li>
                <strong className="text-foreground">Redundancy:</strong> Background queue replicates
                content to additional providers asynchronously
              </li>
              <li>
                <strong className="text-foreground">Resolution:</strong>{' '}
                <Code>resolve(contentHash)</Code> returns the best available URL by checking
                providers in priority order
              </li>
              <li>
                <strong className="text-foreground">On-chain:</strong> Only the <Code>bytes32</Code>{' '}
                content hash is stored on-chain (gas-efficient), full content is in events
              </li>
            </ol>

            <h3 className="text-foreground font-semibold mt-4">Upload Queue</h3>
            <p>
              The async upload queue uses in-memory job tracking with exponential backoff retry (3
              attempts). Jobs progress through: <Code>pending</Code> → <Code>processing</Code> →{' '}
              <Code>completed</Code> | <Code>failed</Code>.
            </p>
          </Section>

          {/* Authentication */}
          <Section id="auth" title="Authentication" icon={Shield}>
            <p>
              Authentication uses <strong className="text-foreground">Firebase Auth</strong> for
              identity management with token-based API authorization.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Auth Flow</h3>
            <CodeBlock>{`1. User signs in via Firebase Auth (email/password)
2. Frontend obtains Firebase ID token: getIdToken()
3. Token included in every tRPC request:
   headers: { Authorization: "Bearer <idToken>" }
4. Server middleware verifies token:
   adminAuth.verifyIdToken(token) → DecodedIdToken
5. User context available in tRPC procedures:
   ctx.user.uid, ctx.user.email, etc.`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Key Files</h3>
            <Table
              headers={['File', 'Purpose']}
              rows={[
                [
                  'apps/web/src/lib/wallet-auth.ts',
                  'useWalletAuth() hook, SIWE session management',
                ],
                ['apps/server/src/lib/firebase.ts', 'Firebase Admin SDK init (Firestore db)'],
                ['apps/server/src/lib/auth.ts', 'verifyAuth() middleware via SIWE JWT'],
                ['apps/server/src/lib/context.ts', 'Request context with authenticated user'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Wallet Signature Verification</h3>
            <p>
              Certain operations (e.g., creating a universe) require a wallet signature in addition
              to Firebase auth. The server verifies the signature against a 5-minute timestamp
              window to prevent replay attacks.
            </p>
          </Section>

          {/* AI Services */}
          <Section id="ai" title="AI Services" icon={Cpu}>
            <p>
              LOAR integrates multiple AI providers for generative media creation, wiki generation,
              and prompt refinement.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Image Generation</h3>
            <Table
              headers={['Model', 'Provider', 'Capabilities']}
              rows={[
                ['Flux', 'FAL', 'High-quality text-to-image'],
                ['Nano Banana', 'FAL', 'Fast text-to-image generation'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Video Generation</h3>
            <Table
              headers={['Model', 'Provider', 'Capabilities']}
              rows={[
                ['Veo3', 'FAL (Google)', 'Text-to-video, image-to-video'],
                ['Kling', 'FAL', 'Text-to-video, image-to-video'],
                ['Wan2.5', 'FAL', 'Text-to-video'],
                ['Sora', 'FAL (OpenAI)', 'Text-to-video'],
                ['RunwayGen3', 'FAL (Runway)', 'Image-to-video'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Content AI</h3>
            <Table
              headers={['Service', 'Provider', 'Use Case']}
              rows={[
                [
                  'Wiki Generation',
                  'Google Gemini',
                  'Auto-generate wiki entries from events/videos',
                ],
                [
                  'Storyline Generation',
                  'Gemini / OpenAI',
                  'Create narrative storylines from prompts',
                ],
                [
                  'Prompt Improvement',
                  'Gemini',
                  'Refine video generation prompts with universe context',
                ],
                ['Video Analysis', 'Gemini', 'Extract narrative content from existing videos'],
              ]}
            />
          </Section>

          {/* Governance Lifecycle */}
          <Section id="governance" title="Governance Lifecycle" icon={Vote}>
            <p>
              Each Cinematic Universe transitions through a{' '}
              <strong className="text-foreground">three-phase lifecycle</strong> from
              creator-controlled to fully decentralized governance. Understanding this lifecycle is
              essential for creators, token buyers, and governance participants.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Phase 1: Creator Control</h3>
            <p>
              When a universe is first created via <Code>UniverseManager.createUniverse()</Code>,
              the creator becomes the <strong className="text-foreground">universe admin</strong>.
              During this phase the creator has full unilateral control over the universe&apos;s
              settings and narrative direction.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Set canon nodes (official storyline)</li>
              <li>Whitelist or restrict who can create nodes</li>
              <li>Change node visibility (public or whitelisted)</li>
              <li>Update node media (content hash and link)</li>
            </ul>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 mt-2">
              <p className="text-yellow-200 text-xs">
                <strong>Trust implication:</strong> During Phase 1 the creator can modify any aspect
                of the universe unilaterally. No token exists yet and there is no governance
                oversight.
              </p>
            </div>

            <h3 className="text-foreground font-semibold mt-4">Phase 2: Token Deployment</h3>
            <p>
              The creator calls <Code>UniverseManager.deployUniverseToken(config)</Code> which
              triggers an irreversible transition. This single transaction:
            </p>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                Deploys a <strong className="text-foreground">GovernanceERC20</strong> token (100
                billion fixed supply)
              </li>
              <li>
                Deploys an <strong className="text-foreground">UniverseGovernor</strong>{' '}
                (OpenZeppelin Governor)
              </li>
              <li>
                Creates a <strong className="text-foreground">Uniswap v4 pool</strong> via the
                configured hook
              </li>
              <li>
                Locks <strong className="text-foreground">100% of token supply</strong> into LP
                positions (permanently)
              </li>
              <li>Transfers admin control from the creator to the governor contract</li>
            </ol>
            <div className="bg-green-500/10 border border-green-500/30 rounded-md p-3 mt-2">
              <p className="text-green-200 text-xs">
                <strong>Key guarantee:</strong> After token deployment the creator no longer has
                admin access. The governor contract becomes the sole admin of the universe. This
                transition is irreversible.
              </p>
            </div>

            <h3 className="text-foreground font-semibold mt-4">
              Phase 3: Decentralized Governance
            </h3>
            <p>
              All admin actions now require a successful governance proposal. Token holders
              participate by delegating voting power and voting on proposals.
            </p>
            <CodeBlock title="Governance Flow">{`1. Acquire tokens    → Buy on Uniswap v4 pool
2. Delegate power    → token.delegate(self) to activate voting
3. Create proposal   → governor.propose(targets, values, calldatas, description)
   Requirement: >= 1 token delegated to proposer
4. Voting opens      → Immediately (votingDelay = 0 blocks)
5. Voting period     → 300 blocks (~1 hour on Ethereum mainnet)
6. Quorum check      → 10% of total voting power must participate
7. Execute           → governor.execute(...) if For > Against
   Actions: setCanon, setNodeCreationOption, setNodeVisibilityOption, etc.`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Governance Parameters</h3>
            <Table
              headers={['Parameter', 'Value', 'Rationale']}
              rows={[
                [
                  'Voting Delay',
                  '0 blocks',
                  'Proposals are immediately votable — fast iteration for creative decisions',
                ],
                [
                  'Voting Period',
                  '300 blocks (~1 hr)',
                  'Short window suits narrative decisions; not financial governance',
                ],
                [
                  'Proposal Threshold',
                  '1 token (1e18)',
                  'Low barrier to propose — any holder can participate',
                ],
                [
                  'Quorum',
                  '10% of voting power',
                  'Ensures meaningful participation without blocking small communities',
                ],
                [
                  'Counting',
                  'Simple (For/Against/Abstain)',
                  'Standard OpenZeppelin GovernorCountingSimple',
                ],
              ]}
            />
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-3 mt-2">
              <p className="text-blue-200 text-xs">
                <strong>Note:</strong> These parameters are set at deployment and cannot be changed.
                A new governor contract would need to be deployed to modify them. This is by design
                — governance rules should be predictable.
              </p>
            </div>

            <h3 className="text-foreground font-semibold mt-4">Governable Actions</h3>
            <Table
              headers={['Action', 'Function', 'Effect']}
              rows={[
                [
                  'Canonize node',
                  'universe.setCanon(nodeId)',
                  'Marks a narrative node as official timeline',
                ],
                [
                  'Change creation rules',
                  'universe.setNodeCreationOption(opt)',
                  'PUBLIC or WHITELISTED node creation',
                ],
                [
                  'Change visibility',
                  'universe.setNodeVisibilityOption(opt)',
                  'PUBLIC or WHITELISTED node visibility',
                ],
                [
                  'Whitelist creator',
                  'universe.setWhitelisted(addr, bool)',
                  'Add/remove addresses from creator whitelist',
                ],
                [
                  'Update media',
                  'universe.setMedia(id, hash, link)',
                  "Change a node's content hash and media link",
                ],
              ]}
            />
          </Section>

          {/* Admin Permissions Matrix */}
          <Section id="admin-permissions" title="Admin Permissions Matrix" icon={Shield}>
            <p>
              Every privileged action in the LOAR protocol is documented below. Understanding who
              can do what is critical for creators, token buyers, and auditors.
            </p>

            <h3 className="text-foreground font-semibold mt-4">UniverseManager (Protocol Level)</h3>
            <p className="text-xs mb-2">
              Controlled by: <strong className="text-foreground">Protocol deployer</strong>{' '}
              (onlyOwner)
            </p>
            <Table
              headers={['Action', 'Function', 'Risk', 'Who is affected']}
              rows={[
                [
                  'Set token deployer',
                  'setTokenDeployer(addr)',
                  'HIGH',
                  'All future universes — determines deployment logic',
                ],
                [
                  'Set fee recipient',
                  'setTeamFeeRecipient(addr)',
                  'MEDIUM',
                  'Protocol revenue destination',
                ],
                [
                  'Claim team fees',
                  'claimTeamFee(token)',
                  'LOW',
                  'Withdraws accumulated protocol fees',
                ],
                [
                  'Deprecate manager',
                  'setDeprecated(bool)',
                  'CRITICAL',
                  'Can disable new universe creation for all users',
                ],
                [
                  'Enable/disable hooks',
                  'setHook(addr, bool)',
                  'HIGH',
                  'Controls which Uniswap hooks can be used',
                ],
                [
                  'Enable/disable lockers',
                  'setLocker(addr, hook, bool)',
                  'HIGH',
                  'Controls which LP lockers can be used',
                ],
              ]}
            />
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 mt-2">
              <p className="text-red-200 text-xs">
                <strong>Critical:</strong> The UniverseManager owner can deprecate the entire
                protocol and control which hooks/lockers are available. This is a centralized trust
                assumption. Existing universes and their governance continue to function
                independently.
              </p>
            </div>

            <h3 className="text-foreground font-semibold mt-4">Universe (Per-Universe Level)</h3>
            <p className="text-xs mb-2">
              Controlled by: <strong className="text-foreground">Universe admin</strong> (creator
              before token, governor after token)
            </p>
            <Table
              headers={['Action', 'Function', 'Risk', 'When available']}
              rows={[
                [
                  'Set canon',
                  'setCanon(nodeId)',
                  'MEDIUM',
                  'Always — determines official storyline',
                ],
                [
                  'Whitelist users',
                  'setWhitelisted(addr, bool)',
                  'LOW',
                  'When creation is WHITELISTED',
                ],
                [
                  'Update media',
                  'setMedia(id, hash, link)',
                  'MEDIUM',
                  'Always — can change node content',
                ],
                [
                  'Change visibility',
                  'setNodeVisibilityOption(opt)',
                  'MEDIUM',
                  'Always — affects who can view nodes',
                ],
                [
                  'Change creation rules',
                  'setNodeCreationOption(opt)',
                  'MEDIUM',
                  'Always — affects who can create nodes',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">LP Locker (Liquidity Level)</h3>
            <p className="text-xs mb-2">
              Controlled by: <strong className="text-foreground">Locker deployer</strong>{' '}
              (onlyOwner) and <strong className="text-foreground">Reward admins</strong>
            </p>
            <Table
              headers={['Action', 'Function', 'Risk', 'Who can call']}
              rows={[
                ['Emergency ETH withdrawal', 'withdrawETH(addr)', 'CRITICAL', 'Locker owner only'],
                [
                  'Emergency token withdrawal',
                  'withdrawERC20(token, addr)',
                  'CRITICAL',
                  'Locker owner only',
                ],
                [
                  'Change reward recipient',
                  'updateRewardRecipient(token, idx, addr)',
                  'MEDIUM',
                  'Reward admin for that index only',
                ],
                [
                  'Change reward admin',
                  'updateRewardAdmin(token, idx, addr)',
                  'HIGH',
                  'Current reward admin only',
                ],
                ['Collect rewards', 'collectRewards(token)', 'LOW', 'Anyone (permissionless)'],
              ]}
            />
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3 mt-2">
              <p className="text-red-200 text-xs">
                <strong>Critical:</strong> The locker owner can withdraw ERC20 tokens and ETH via
                emergency functions. While LP positions themselves are permanently locked,
                accumulated fees and any tokens sent to the locker can be withdrawn by the owner.
                This is a trust assumption token buyers should understand.
              </p>
            </div>

            <h3 className="text-foreground font-semibold mt-4">LoarFeeLocker (Fee Escrow)</h3>
            <p className="text-xs mb-2">
              Controlled by: <strong className="text-foreground">Fee locker owner</strong>{' '}
              (onlyOwner)
            </p>
            <Table
              headers={['Action', 'Function', 'Risk', 'Who can call']}
              rows={[
                [
                  'Add depositor',
                  'addDepositor(addr)',
                  'HIGH',
                  'Owner only — controls who can deposit fees',
                ],
                [
                  'Store fees',
                  'storeFees(owner, token, amt)',
                  'LOW',
                  'Whitelisted depositors only',
                ],
                [
                  'Claim fees',
                  'claim(feeOwner, token)',
                  'LOW',
                  'Anyone (sends to feeOwner, not caller)',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Actions Nobody Can Take</h3>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong className="text-foreground">Mint new tokens:</strong> GovernanceERC20 has no
                mint function. Supply is fixed at 100 billion.
              </li>
              <li>
                <strong className="text-foreground">Remove LP liquidity:</strong> Positions are
                permanently locked in LoarLpLockerMultiple. No withdrawal function exists for LP
                positions.
              </li>
              <li>
                <strong className="text-foreground">Change governance parameters:</strong> Voting
                delay, period, quorum, and threshold are hardcoded in the governor constructor.
              </li>
              <li>
                <strong className="text-foreground">Reverse token deployment:</strong> Once a
                universe deploys a token, admin control permanently transfers to the governor.
              </li>
              <li>
                <strong className="text-foreground">Delete narrative nodes:</strong> Nodes are
                append-only. Once created, they cannot be removed from the on-chain graph.
              </li>
            </ul>
          </Section>

          {/* Trust Model */}
          <Section id="trust-model" title="Trust Model" icon={Shield}>
            <p>
              LOAR has different trust assumptions depending on your role. This section explains
              what you are trusting and what guarantees you have.
            </p>

            <h3 className="text-foreground font-semibold mt-4">For Universe Creators</h3>
            <div className="space-y-3">
              <div className="border border-border rounded-md p-3 bg-card/50">
                <p className="text-foreground font-medium text-sm">Before Token Deployment</p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>
                    You have <strong className="text-foreground">full control</strong> over your
                    universe
                  </li>
                  <li>
                    You can set canon, whitelist creators, change visibility, and update media
                  </li>
                  <li>No one else can modify your universe settings</li>
                  <li>
                    You trust: <strong className="text-foreground">UniverseManager owner</strong>{' '}
                    not to deprecate the protocol
                  </li>
                </ul>
              </div>
              <div className="border border-border rounded-md p-3 bg-card/50">
                <p className="text-foreground font-medium text-sm">After Token Deployment</p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>
                    You <strong className="text-foreground">permanently lose admin access</strong> —
                    the governor contract takes over
                  </li>
                  <li>
                    To influence the universe you must hold tokens and participate in governance
                  </li>
                  <li>
                    100% of tokens go into the Uniswap v4 pool — you acquire tokens by buying on the
                    open market like everyone else
                  </li>
                  <li>Your narrative contributions remain on-chain and cannot be deleted</li>
                </ul>
              </div>
            </div>

            <h3 className="text-foreground font-semibold mt-4">For Token Buyers</h3>
            <div className="space-y-3">
              <div className="border border-green-500/30 rounded-md p-3 bg-green-500/5">
                <p className="text-green-200 font-medium text-sm">
                  What You Can Trust (On-Chain Guarantees)
                </p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>
                    <strong className="text-foreground">Fixed supply:</strong> No one can mint new
                    tokens. 100 billion is the permanent cap.
                  </li>
                  <li>
                    <strong className="text-foreground">Locked liquidity:</strong> 100% of tokens
                    are in permanently locked LP positions. No rug pull possible via LP withdrawal.
                  </li>
                  <li>
                    <strong className="text-foreground">Governance rights:</strong> Your tokens
                    grant proportional voting power on universe decisions.
                  </li>
                  <li>
                    <strong className="text-foreground">Transparent fees:</strong> Swap fees are set
                    per-pool at deployment and enforced by the hook contract.
                  </li>
                  <li>
                    <strong className="text-foreground">Immutable rules:</strong> Governance
                    parameters (quorum, voting period, threshold) cannot be changed after
                    deployment.
                  </li>
                </ul>
              </div>
              <div className="border border-yellow-500/30 rounded-md p-3 bg-yellow-500/5">
                <p className="text-yellow-200 font-medium text-sm">
                  What Requires Trust (Centralized Assumptions)
                </p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>
                    <strong className="text-foreground">Protocol owner:</strong> The UniverseManager
                    owner can deprecate the factory (but cannot affect existing universes or
                    tokens).
                  </li>
                  <li>
                    <strong className="text-foreground">Locker owner:</strong> Can call emergency
                    withdrawETH/withdrawERC20 on the LP locker contract. LP positions are locked but
                    accumulated fees could be withdrawn.
                  </li>
                  <li>
                    <strong className="text-foreground">Fee locker owner:</strong> Controls which
                    addresses can deposit fees into escrow.
                  </li>
                  <li>
                    <strong className="text-foreground">Off-chain content:</strong> Video files and
                    plot text are stored off-chain (events + decentralized storage). Only content
                    hashes are verified on-chain.
                  </li>
                  <li>
                    <strong className="text-foreground">Testnet status:</strong> Current deployment
                    is on Sepolia testnet. Tokens have no monetary value. Production deployment will
                    require audit and re-deployment.
                  </li>
                </ul>
              </div>
              <div className="border border-red-500/30 rounded-md p-3 bg-red-500/5">
                <p className="text-red-200 font-medium text-sm">Known Risks</p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>
                    <strong className="text-foreground">Short voting period:</strong> 300 blocks (~1
                    hour) may not give all holders time to vote, especially across time zones.
                  </li>
                  <li>
                    <strong className="text-foreground">Zero voting delay:</strong> Proposals are
                    votable immediately — no time to review before voting starts.
                  </li>
                  <li>
                    <strong className="text-foreground">Low proposal threshold:</strong> Anyone with
                    1 token can create proposals, which could lead to spam.
                  </li>
                  <li>
                    <strong className="text-foreground">No timelock:</strong> Executed proposals
                    take effect immediately with no delay for review or exit.
                  </li>
                  <li>
                    <strong className="text-foreground">No emergency pause:</strong> There is no
                    circuit breaker or pause mechanism in universe contracts.
                  </li>
                </ul>
              </div>
            </div>

            <h3 className="text-foreground font-semibold mt-4">For Auditors and Partners</h3>
            <Table
              headers={['Component', 'Trust Model', 'Upgrade Path']}
              rows={[
                ['UniverseManager', 'Ownable (single admin)', 'Owner can transfer ownership'],
                ['Universe', 'Admin → Governor transition', 'Irreversible after token deploy'],
                ['GovernanceERC20', 'No admin functions', 'Immutable after deployment'],
                [
                  'UniverseGovernor',
                  'OpenZeppelin Governor',
                  'Parameters immutable, no upgrade proxy',
                ],
                [
                  'LoarHookStaticFee',
                  'Factory-controlled init',
                  'Fees set per-pool at pool creation',
                ],
                ['LoarLpLockerMultiple', 'Owner + reward admins', 'Owner has emergency withdrawal'],
                ['LoarFeeLocker', 'Owner-controlled depositors', 'Owner can add new depositors'],
              ]}
            />
          </Section>

          {/* Canon Integrity */}
          <Section id="canon-integrity" title="Canon Integrity" icon={Blocks}>
            <p>
              LOAR&apos;s narrative model uses a hybrid on-chain/off-chain architecture.
              Understanding what is verified on-chain vs what lives off-chain is essential for
              trusting the canonical storyline.
            </p>

            <h3 className="text-foreground font-semibold mt-4">What Lives On-Chain</h3>
            <Table
              headers={['Data', 'Storage', 'Verification']}
              rows={[
                [
                  'Node graph structure',
                  'Universe contract mapping',
                  'Fully on-chain — previousNodeId forms a tree',
                ],
                [
                  'Content hash (bytes32)',
                  'Universe contract per node',
                  'SHA-256 of media content — tamper-evident',
                ],
                [
                  'Plot hash (bytes32)',
                  'Universe contract per node',
                  'SHA-256 of plot text — tamper-evident',
                ],
                [
                  'Canon flag',
                  'Universe contract',
                  'Set by admin/governor — on-chain record of official timeline',
                ],
                [
                  'Node creator address',
                  'Universe contract per node',
                  'Immutable record of who created each node',
                ],
                ['Token balances', 'GovernanceERC20 contract', 'Standard ERC20 — fully on-chain'],
                [
                  'Governance proposals',
                  'UniverseGovernor contract',
                  'Proposal state, votes, execution — fully on-chain',
                ],
                [
                  'Pool state',
                  'Uniswap v4 PoolManager',
                  'Swap prices, liquidity, tick — fully on-chain',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">What Lives Off-Chain</h3>
            <Table
              headers={['Data', 'Storage', 'How to verify']}
              rows={[
                [
                  'Video/image files',
                  'Pinata, Lighthouse, Storacha, Firebase',
                  'Hash the retrieved file and compare to on-chain contentHash',
                ],
                [
                  'Full plot text',
                  'Event logs + decentralized storage',
                  'Hash the text and compare to on-chain plotHash',
                ],
                [
                  'Media URLs (link)',
                  'Event logs + decentralized storage',
                  'URLs emitted in NodeCreated events — retrievable from any archive node',
                ],
                [
                  'Proposal descriptions',
                  'Event logs',
                  'Emitted in ProposalCreated events — not stored in contract state',
                ],
                [
                  'Vote reasons',
                  'Event logs',
                  'Emitted in VoteCast events — optional and off-chain',
                ],
                [
                  'Token metadata',
                  'GovernanceERC20 fields',
                  'imageUrl, metadata, context stored in contract but not hash-verified',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Content Verification Flow</h3>
            <CodeBlock title="Verifying a Node's Content">{`1. Read node from contract:
   Universe.getNode(nodeId) → { contentHash, plotHash, link, plot, ... }

2. Retrieve content from storage:
   GET link → video/image binary data

3. Verify integrity:
   SHA-256(binary data) === contentHash  → content is authentic
   SHA-256(plot text)   === plotHash     → plot is authentic

4. Verify canon status:
   node.canon === true → this node is part of the official timeline
   Check who canonized: NodeCanonized event → address of canonizer
   Before token: canonizer = creator
   After token:  canonizer = governor (via proposal execution)`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Indexer Event Coverage</h3>
            <p>
              The Ponder indexer tracks all on-chain events needed to reconstruct the full narrative
              state. If the indexer is unavailable, all data can be reconstructed from blockchain
              event logs.
            </p>
            <Table
              headers={['Event', 'Contract', 'What it captures']}
              rows={[
                ['UniverseCreated', 'UniverseManager', 'New universe address and creator'],
                [
                  'TokenCreated',
                  'UniverseManager',
                  'Token, governor, pool, hook, locker addresses',
                ],
                [
                  'NodeCreated',
                  'Universe',
                  'Full node data including link and plot text in event args',
                ],
                ['NodeCanonized', 'Universe', 'Which node was canonized and by whom'],
                ['MediaUpdated', 'Universe', 'Updated content hash and link'],
                [
                  'ProposalCreated',
                  'UniverseGovernor',
                  'Full proposal details including description',
                ],
                ['VoteCast', 'UniverseGovernor', 'Voter, support, weight, and reason'],
                ['ProposalExecuted', 'UniverseGovernor', 'Confirms proposal was executed on-chain'],
                ['ProposalCanceled', 'UniverseGovernor', 'Proposal cancellation record'],
                ['Transfer', 'GovernanceERC20', 'All token transfers for balance tracking'],
                ['Swap', 'PoolManager', 'All pool swaps for price/volume tracking'],
              ]}
            />
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-md p-3 mt-2">
              <p className="text-blue-200 text-xs">
                <strong>Integrity guarantee:</strong> Because content hashes are stored on-chain and
                full content is emitted in events, anyone can independently verify that off-chain
                content matches what was committed. The indexer is a convenience layer — not a trust
                requirement.
              </p>
            </div>
          </Section>

          {/* Token Economics */}
          <Section id="token-economics" title="Token Economics" icon={Wallet}>
            <p>
              Each universe&apos;s governance token follows a fixed-supply, fully-liquid model.
              There are no bonding curves, no vesting schedules, and no team allocations.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Token Supply Model</h3>
            <Table
              headers={['Parameter', 'Value', 'Rationale']}
              rows={[
                [
                  'Total Supply',
                  '100,000,000,000 (100B)',
                  'Large supply for granular ownership and low per-token price',
                ],
                ['Decimals', '18', 'Standard ERC20 precision'],
                [
                  'Initial Distribution',
                  '100% to LP',
                  'All tokens go into Uniswap v4 pool — no pre-mine, no team allocation',
                ],
                ['Minting', 'Disabled', 'No mint function exists — supply is permanently fixed'],
                [
                  'Burning',
                  'Not implemented',
                  'Standard ERC20 — tokens sent to address(0) are effectively burned',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Fee Structure</h3>
            <CodeBlock title="Fee Flow per Swap">{`Swap on Uniswap v4 Pool
├── LP Fee (configurable per pool, e.g., 0.3%)
│   ├── 80% → LP position holders (locked in LoarLpLockerMultiple)
│   │         └── Distributed to reward recipients by BPS split
│   │             └── Stored in LoarFeeLocker → claimable anytime
│   └── 20% → Protocol fee (LoarHookStaticFee)
│             └── Sent to UniverseManager → claimable by team fee recipient
│
├── loarFee: fee when buying governance token (0-30% max)
└── pairedFee: fee when selling governance token (0-30% max)`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Fee Parameters</h3>
            <Table
              headers={['Parameter', 'Range', 'Default', 'Rationale']}
              rows={[
                [
                  'loarFee (buy fee)',
                  '0 — 30%',
                  '0.3% (3000 bps)',
                  'Competitive with standard DEX fees',
                ],
                [
                  'pairedFee (sell fee)',
                  '0 — 30%',
                  '0.3% (3000 bps)',
                  'Symmetric to avoid directional bias',
                ],
                [
                  'Protocol fee',
                  'Fixed 20% of LP fee',
                  'N/A',
                  'Sustainable protocol revenue without excessive extraction',
                ],
                ['MAX_LP_FEE', '30% (300,000)', 'N/A', 'Hard cap prevents abusive fee settings'],
              ]}
            />
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-md p-3 mt-2">
              <p className="text-yellow-200 text-xs">
                <strong>Upgrade policy:</strong> Fees are set per-pool at pool creation time and
                cannot be changed after deployment. To modify fees, a new pool would need to be
                created. The 20% protocol fee split is hardcoded in the hook contract.
              </p>
            </div>

            <h3 className="text-foreground font-semibold mt-4">LP Position Structure</h3>
            <Table
              headers={['Parameter', 'Value', 'Rationale']}
              rows={[
                ['Max positions per token', '7', 'Multiple tick ranges for concentrated liquidity'],
                [
                  'Lock duration',
                  'Permanent',
                  'No withdrawal function — LP positions are locked forever',
                ],
                ['Reward recipients', 'Up to 7', 'Configurable BPS split (must total 10,000)'],
                [
                  'Reward admin',
                  'Per-recipient',
                  'Each recipient slot has its own admin who can change the recipient',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Reward Distribution</h3>
            <p>
              Swap fees accumulate in LP positions. Anyone can call{' '}
              <Code>collectRewards(token)</Code> to trigger distribution. Fees are split according
              to <Code>rewardBps</Code> and sent to <Code>LoarFeeLocker</Code>
              where recipients can claim at any time.
            </p>
            <ul className="list-disc list-inside space-y-1 mt-2">
              <li>
                <strong className="text-foreground">Permissionless collection:</strong> Anyone can
                trigger fee collection — no admin required
              </li>
              <li>
                <strong className="text-foreground">Transparent splits:</strong> BPS allocations are
                set at deployment and visible on-chain
              </li>
              <li>
                <strong className="text-foreground">Admin flexibility:</strong> Each reward admin
                can change their own recipient address (e.g., to a DAO treasury)
              </li>
            </ul>
          </Section>

          {/* Contract Release Checklist */}
          <Section id="contract-release" title="Contract Release & Verification" icon={FileCode}>
            <p>
              This section defines the deployment, verification, and versioning process for LOAR
              smart contracts.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Deployment Order</h3>
            <CodeBlock title="Protocol Infrastructure (one-time)">{`1. Deploy UniverseManager(teamFeeRecipient)
2. Deploy UniverseTokenDeployer(universeManager)
3. UniverseManager.setTokenDeployer(tokenDeployer)
4. Deploy LoarFeeLocker(deployer)
5. Deploy LoarLpLockerMultiple(deployer, universeManager, feeLocker, positionManager, permit2)
6. Mine hook address using HookMiner (CREATE2 salt for correct flag bits)
7. Deploy LoarHookStaticFee{salt}(poolManager, universeManager, weth)
8. LoarFeeLocker.addDepositor(lpLocker)
9. UniverseManager.setHook(hook, true)
10. UniverseManager.setLocker(locker, hook, true)`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Pre-Deployment Checklist</h3>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong className="text-foreground">Tests pass:</strong> <Code>forge test</Code> —
                all unit and integration tests green
              </li>
              <li>
                <strong className="text-foreground">Gas report:</strong>{' '}
                <Code>forge test --gas-report</Code> — review gas costs for key operations
              </li>
              <li>
                <strong className="text-foreground">Slither/static analysis:</strong> Run{' '}
                <Code>slither .</Code> and address all high/medium findings
              </li>
              <li>
                <strong className="text-foreground">Environment vars:</strong> Verify PRIVATE_KEY,
                POOL_MANAGER, POSITION_MANAGER, PERMIT2, WETH, TEAM_FEE_RECIPIENT
              </li>
              <li>
                <strong className="text-foreground">Dry run:</strong> Deploy to a local fork first —{' '}
                <Code>forge script --fork-url</Code>
              </li>
              <li>
                <strong className="text-foreground">Peer review:</strong> Deployment script reviewed
                by at least one other team member
              </li>
            </ul>

            <h3 className="text-foreground font-semibold mt-4">Post-Deployment Checklist</h3>
            <ul className="list-disc list-inside space-y-2">
              <li>
                <strong className="text-foreground">Verify contracts:</strong>{' '}
                <Code>forge verify-contract</Code> on Etherscan with <Code>--verify</Code> flag
              </li>
              <li>
                <strong className="text-foreground">Regenerate ABIs:</strong>{' '}
                <Code>forge build && npx wagmi generate</Code>
              </li>
              <li>
                <strong className="text-foreground">Build ABI package:</strong>{' '}
                <Code>cd packages/abis && pnpm build:ts</Code>
              </li>
              <li>
                <strong className="text-foreground">Update addresses:</strong> Commit new addresses
                to <Code>packages/abis</Code>
              </li>
              <li>
                <strong className="text-foreground">Smoke test:</strong> Create a test universe,
                deploy a token, verify governance flow end-to-end
              </li>
              <li>
                <strong className="text-foreground">Update indexer:</strong> Update Ponder config
                with new contract addresses if changed
              </li>
              <li>
                <strong className="text-foreground">Archive broadcast:</strong> Commit{' '}
                <Code>apps/contracts/broadcast/</Code> artifacts to git
              </li>
            </ul>

            <h3 className="text-foreground font-semibold mt-4">Versioning & Artifacts</h3>
            <Table
              headers={['Artifact', 'Location', 'Purpose']}
              rows={[
                [
                  'Contract source',
                  'apps/contracts/src/',
                  'Solidity source files — versioned in git',
                ],
                [
                  'Broadcast logs',
                  'apps/contracts/broadcast/',
                  'Deployment tx hashes, addresses, constructor args',
                ],
                [
                  'Generated ABIs',
                  'packages/abis/src/',
                  'TypeScript types and wagmi hooks from contract ABIs',
                ],
                ['Contract addresses', 'packages/abis/', 'Deployed addresses per network'],
                [
                  'Etherscan verification',
                  'Etherscan explorer',
                  'Public source verification with constructor args',
                ],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Testnet vs Production</h3>
            <div className="space-y-3">
              <div className="border border-yellow-500/30 rounded-md p-3 bg-yellow-500/5">
                <p className="text-yellow-200 font-medium text-sm">
                  Current Status: Sepolia Testnet
                </p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>All contracts deployed on Sepolia (chain ID 11155111)</li>
                  <li>
                    Tokens have <strong className="text-foreground">no monetary value</strong>
                  </li>
                  <li>Governance proposals are for testing only</li>
                  <li>Contract code has not been formally audited</li>
                  <li>
                    Deployment artifacts stored in{' '}
                    <Code>broadcast/DeployProtocol.s.sol/11155111/</Code>
                  </li>
                </ul>
              </div>
              <div className="border border-border rounded-md p-3 bg-card/50">
                <p className="text-foreground font-medium text-sm">
                  Production Requirements (Before Mainnet)
                </p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>
                    <strong className="text-foreground">Security audit:</strong> Full audit by a
                    reputable firm (OpenZeppelin, Trail of Bits, etc.)
                  </li>
                  <li>
                    <strong className="text-foreground">Bug bounty:</strong> Establish a bug bounty
                    program before mainnet launch
                  </li>
                  <li>
                    <strong className="text-foreground">Governance parameter review:</strong>{' '}
                    Evaluate voting period and quorum for mainnet conditions
                  </li>
                  <li>
                    <strong className="text-foreground">Multi-sig ownership:</strong> Transfer
                    UniverseManager and locker ownership to a multi-sig (e.g., Safe)
                  </li>
                  <li>
                    <strong className="text-foreground">Emergency procedures:</strong> Document
                    incident response for contract vulnerabilities
                  </li>
                  <li>
                    <strong className="text-foreground">Formal verification:</strong> Consider
                    formal verification of core invariants (fixed supply, locked LP)
                  </li>
                </ul>
              </div>
            </div>
          </Section>

          {/* API Reference */}
          <Section id="api" title="API Reference" icon={Network}>
            <h3 className="text-foreground font-semibold">Server API (tRPC)</h3>
            <p>
              The tRPC API is type-safe end-to-end. The client is configured at{' '}
              <Code>apps/web/src/utils/trpc.ts</Code> and auto-includes the Firebase auth token in
              every request.
            </p>
            <CodeBlock title="tRPC Client Usage">{`import { trpcClient } from '@/utils/trpc';

// Query
const universes = await trpcClient.universes.getAll.query();

// Mutation (image generation)
const result = await trpcClient.image.generateImage.mutate({
  prompt: "A cyberpunk cityscape",
  model: "flux",
});`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Ponder GraphQL API</h3>
            <p>
              The indexer exposes a GraphQL endpoint at <Code>http://localhost:42069</Code>{' '}
              (configurable via <Code>VITE_PONDER_URL</Code>).
            </p>
            <CodeBlock title="GraphQL Query">{`import { ponderGql } from '@/utils/ponder-api';

const data = await ponderGql<{
  universes: { items: Universe[] }
}>(\`{
  universes(orderBy: "createdAt", orderDirection: "desc") {
    items {
      id name description image nodeCount
      tokenAddress governorAddress createdAt
    }
  }
}\`);`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Contract Interactions (Wagmi)</h3>
            <p>
              Generated Wagmi hooks are exported from <Code>@loar/abis</Code> for type-safe contract
              interactions.
            </p>
            <CodeBlock title="Contract Write Example">{`import { useWriteUniverseCreateNode } from '@loar/abis';

const { writeContract } = useWriteUniverseCreateNode();

writeContract({
  address: universeAddress,
  args: [contentHash, plotHash, previousNodeId, linkUrl, plotText],
});`}</CodeBlock>
          </Section>

          {/* Environment Variables */}
          <Section id="env" title="Environment Variables" icon={Key}>
            <p>
              All environment variables are centralized in a single <Code>.env</Code> file at the
              monorepo root. Vite variables are prefixed with <Code>VITE_</Code> for client-side
              exposure.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Firebase</h3>
            <Table
              headers={['Variable', 'Description']}
              rows={[
                [
                  'FIREBASE_SERVICE_ACCOUNT',
                  'Firebase Admin service account JSON (inline or base64)',
                ],
                ['FIREBASE_SERVICE_ACCOUNT_PATH', 'Alternative: path to service account JSON file'],
                ['FIREBASE_STORAGE_BUCKET', 'Firebase Storage bucket name'],
                ['VITE_FIREBASE_API_KEY', 'Firebase client API key'],
                ['VITE_FIREBASE_AUTH_DOMAIN', 'Firebase Auth domain'],
                ['VITE_FIREBASE_PROJECT_ID', 'Firebase project ID'],
                ['VITE_FIREBASE_STORAGE_BUCKET', 'Firebase Storage bucket (client)'],
                ['VITE_FIREBASE_MESSAGING_SENDER_ID', 'Firebase messaging sender ID'],
                ['VITE_FIREBASE_APP_ID', 'Firebase app ID'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Server & Client</h3>
            <Table
              headers={['Variable', 'Default', 'Description']}
              rows={[
                ['PORT', '3000', 'Server port'],
                ['CORS_ORIGIN', '', 'Allowed CORS origin (required in production)'],
                ['VITE_SERVER_URL', 'http://localhost:3000', 'Backend URL for frontend'],
                ['VITE_PONDER_URL', 'http://localhost:42069', 'Indexer GraphQL URL for frontend'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">AI Services</h3>
            <Table
              headers={['Variable', 'Description']}
              rows={[
                ['FAL_KEY', 'FAL.ai API key for image/video generation'],
                ['GOOGLE_API_KEY', 'Google Generative AI (Gemini) key'],
                ['OPENAI_API_KEY', 'OpenAI API key'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Blockchain</h3>
            <Table
              headers={['Variable', 'Description']}
              rows={[
                ['PRIVATE_KEY', 'Wallet private key (for Filecoin uploads)'],
                ['PONDER_RPC_URL_2', 'Sepolia RPC URL (e.g., Alchemy)'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Decentralized Storage</h3>
            <Table
              headers={['Variable', 'Default', 'Description']}
              rows={[
                ['PINATA_JWT', '', 'Pinata IPFS API token'],
                ['PINATA_GATEWAY_URL', '', 'Pinata IPFS gateway URL'],
                ['LIGHTHOUSE_API_KEY', '', 'Lighthouse Filecoin API key'],
                ['STORACHA_KEY', '', 'Storacha DID key'],
                ['STORACHA_PROOF', '', 'Storacha delegation proof (base64)'],
                [
                  'STORAGE_PROVIDER_PRIORITY',
                  'pinata,lighthouse,storacha,firebase',
                  'Provider priority order',
                ],
              ]}
            />
          </Section>

          {/* Deployment */}
          <Section id="deployment" title="Deployment" icon={GitBranch}>
            <h3 className="text-foreground font-semibold">Development</h3>
            <CodeBlock title="Getting Started">{`# Install dependencies
pnpm install

# Start all services in development
pnpm dev

# This starts:
#   apps/web     → http://localhost:5173 (Vite dev server)
#   apps/server  → http://localhost:3000 (Hono server)
#   apps/indexer → http://localhost:42069 (Ponder indexer)

# Run smart contract tests
pnpm sc:test`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Docker</h3>
            <p>
              Each app has its own Dockerfile using multi-stage builds with{' '}
              <Code>node:20-alpine</Code>.
            </p>
            <Table
              headers={['Service', 'Port', 'Health Check']}
              rows={[
                ['web', '3001', 'wget http://localhost:3001'],
                ['server', '3000', 'curl http://localhost:3000/health'],
                ['indexer', '42069', 'N/A'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">CI/CD</h3>
            <p>Two GitHub Actions workflows:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>
                <strong className="text-foreground">ci.yml:</strong> Quality checks (format, lint,
                type-check), builds, and Forge contract tests
              </li>
              <li>
                <strong className="text-foreground">deploy.yml:</strong> Auto-deploy on push to{' '}
                <Code>main</Code> &mdash; SSH into server, git pull, pnpm install/build, docker
                compose restart
              </li>
            </ul>

            <h3 className="text-foreground font-semibold mt-4">Smart Contract Deployment</h3>
            <CodeBlock title="Contract Workflow">{`# Build contracts
cd apps/contracts && forge build

# Run tests
forge test

# After deploying, regenerate ABIs
npx wagmi generate

# Build the shared ABIs package
cd packages/abis && pnpm build:ts`}</CodeBlock>
          </Section>

          <div className="mt-8 border-t border-border pt-6 text-center text-xs text-muted-foreground">
            <p>LOAR &mdash; Decentralized Narrative Control Suite</p>
            <p className="mt-1">Sepolia Testnet &middot; loar.fun</p>
          </div>
        </main>
      </div>
    </div>
  );
}
