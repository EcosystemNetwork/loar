import { createFileRoute, Link } from '@tanstack/react-router';
import Header from '@/components/header';
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
      {open && <div className="px-6 py-5 space-y-4 text-sm leading-relaxed text-muted-foreground">{children}</div>}
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-foreground">{children}</code>
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
              <th key={h} className="text-left px-4 py-2 font-semibold text-foreground border-b border-border">
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
  { id: 'governance', label: 'Governance' },
  { id: 'api', label: 'API Reference' },
  { id: 'env', label: 'Environment Variables' },
  { id: 'deployment', label: 'Deployment' },
];

function DocsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="container mx-auto px-4 py-8 flex gap-8">
        {/* Sidebar Navigation */}
        <aside className="hidden lg:block w-56 shrink-0">
          <nav className="sticky top-24 space-y-1">
            <p className="text-xs font-semibold uppercase text-muted-foreground mb-3 tracking-wider">Documentation</p>
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
              <strong className="text-foreground">LOAR</strong> is a decentralized narrative control suite that combines
              Web3 blockchain governance, AI-powered content generation, and decentralized storage to enable
              collaborative storytelling at scale.
            </p>
            <p>
              Users create <strong className="text-foreground">Cinematic Universes</strong> &mdash; on-chain narrative
              containers where communities collaboratively build stories through video nodes, governance proposals, and
              tokenized participation.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 mt-2">
              {[
                ['Cinematic Universes', 'On-chain narrative containers with branching storylines'],
                ['AI Generation', 'Text-to-image and text-to-video via FAL, Veo3, Kling, and more'],
                ['Token Governance', 'ERC20 governance tokens with proposal voting per universe'],
                ['Decentralized Storage', 'Multi-provider (Walrus, IPFS, Synapse, Firebase) with fallback'],
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
  ├─► Frontend (React + Wagmi) ──► Wallet (MetaMask/RainbowKit)
  │     │                                    │
  │     ├─► tRPC Client ──────────► Server (Hono + tRPC)
  │     │                              │
  │     │                              ├─► Firebase (Auth + Firestore)
  │     │                              ├─► FAL / Gemini / OpenAI (AI)
  │     │                              └─► Storage Manager
  │     │                                    ├─► Walrus (Sui)
  │     │                                    ├─► IPFS (Pinata)
  │     │                                    ├─► Synapse (Filecoin)
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
                ['Frontend', 'React 18, Vite 6, TailwindCSS v4, TanStack Router/Query, Wagmi, RainbowKit'],
                ['Backend', 'Hono, tRPC, Firebase Admin, Node.js 20'],
                ['Contracts', 'Solidity 0.8.30+, Foundry, OpenZeppelin, Uniswap v4'],
                ['Indexer', 'Ponder v0.15, PostgreSQL, GraphQL'],
                ['Storage', 'Walrus, IPFS (Pinata), Synapse (Filecoin), Firebase Storage'],
                ['AI', 'FAL (Flux, Veo3, Kling, Wan25, Sora), Google Gemini, OpenAI'],
                ['Auth', 'Firebase Auth (email/password + wallet)'],
                ['Database', 'Firebase Firestore'],
                ['Infra', 'Docker, Turborepo, pnpm workspaces'],
              ]}
            />
          </Section>

          {/* Frontend */}
          <Section id="frontend" title="Frontend (apps/web)" icon={Globe}>
            <p>
              The frontend is a single-page app built with <strong className="text-foreground">React 18</strong> and
              <strong className="text-foreground"> Vite 6</strong>, using file-based routing via TanStack Router.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Routes</h3>
            <Table
              headers={['Path', 'Component', 'Description']}
              rows={[
                ['/', 'HomeComponent', 'Landing page with universe explorer, activity feed, trending tokens'],
                ['/login', 'LoginPage', 'CDP Smart Wallet sign-in with social logins (Google, passkeys, email)'],
                ['/dashboard', 'Dashboard', 'User dashboard with universes list and AI media generation'],
                ['/cinematicUniverseCreate', 'CreateUniverse', 'Multi-step universe creation wizard'],
                ['/universe/:id', 'UniverseView', 'Universe detail with timeline, nodes, and governance'],
                ['/event/:universe/:event', 'EventViewer', 'Individual narrative event/node viewer'],
                ['/market', 'Market', 'Token marketplace and trading interface'],
                ['/docs', 'DocsPage', 'This documentation page'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Key Components</h3>
            <Table
              headers={['Component', 'Purpose']}
              rows={[
                ['DirectUpload', 'Drag-and-drop file upload (multipart, bypasses tRPC for large files)'],
                ['EventCreationSidebar', 'Timeline event creation with narrative options'],
                ['FlowCreationPanel', 'Visual flow editor using ReactFlow for narrative sequences'],
                ['SceneEditor / SceneBuilder', 'Visual scene composition and editing tools'],
                ['GenerativeMedia', 'AI image/video generation UI with model selection'],
                ['GovernanceSidebar', 'Governance proposal creation and voting interface'],
                ['WalletConnectButton', 'RainbowKit wallet connection wrapper'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Custom Hooks</h3>
            <Table
              headers={['Hook', 'Purpose']}
              rows={[
                ['useCharacterGeneration', 'AI image generation for characters (Flux, Nano Banana models)'],
                ['useVideoGeneration', 'Video generation via FAL (Veo3, Kling, Wan25, Sora, RunwayGen3)'],
                ['useContractSave', 'Blockchain write operations (create node with content/plot hashes)'],
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
              <li><strong className="text-foreground">Server state:</strong> TanStack Query via tRPC client &mdash; auto-caching, invalidation, optimistic updates</li>
              <li><strong className="text-foreground">Blockchain state:</strong> Ponder GraphQL queries via <Code>ponderGql()</Code> utility + React Query</li>
              <li><strong className="text-foreground">Wallet state:</strong> Wagmi hooks (<Code>useAccount</Code>, <Code>useWriteContract</Code>, etc.)</li>
              <li><strong className="text-foreground">Auth state:</strong> <Code>useAuth()</Code> hook backed by Firebase Auth listener</li>
            </ul>
          </Section>

          {/* Backend */}
          <Section id="backend" title="Backend (apps/server)" icon={Server}>
            <p>
              The server is a <strong className="text-foreground">Hono</strong> HTTP framework with{' '}
              <strong className="text-foreground">tRPC</strong> for type-safe RPC, running on Node.js 20.
            </p>

            <h3 className="text-foreground font-semibold mt-4">HTTP Endpoints</h3>
            <Table
              headers={['Method', 'Path', 'Description']}
              rows={[
                ['GET', '/', 'Status endpoint'],
                ['GET', '/health', 'Health check'],
                ['POST', '/api/upload', 'Direct multipart file upload (up to 200MB, auth required)'],
                ['GET', '/api/filecoin/:pieceCid', 'Stream Filecoin content (auth required)'],
                ['ALL', '/trpc/*', 'tRPC router (all procedures)'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">tRPC Routers</h3>

            <h4 className="text-foreground font-medium mt-3">cinematicUniverses</h4>
            <Table
              headers={['Procedure', 'Type', 'Description']}
              rows={[
                ['createcu', 'mutation', 'Create universe (requires wallet signature with 5-min timestamp window)'],
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
                ['generateVideo', 'mutation', 'Text/image-to-video (Veo3, Kling, Wan25, Sora, RunwayGen3)'],
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
                ['activeUploads', 'query', 'List user\'s active upload jobs'],
                ['recentUploads', 'query', 'List user\'s recent upload history'],
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
              <li><strong className="text-foreground">CORS</strong> &mdash; Configurable origin via <Code>CORS_ORIGIN</Code></li>
              <li><strong className="text-foreground">Rate Limiting</strong> &mdash; 100 requests/min per IP</li>
              <li><strong className="text-foreground">Security Headers</strong> &mdash; Standard security headers (CSP, XSS, etc.)</li>
              <li><strong className="text-foreground">Error Handler</strong> &mdash; Dev/prod modes with stack traces in dev</li>
              <li><strong className="text-foreground">Logger</strong> &mdash; Request logging</li>
            </ul>
          </Section>

          {/* Smart Contracts */}
          <Section id="contracts" title="Smart Contracts (apps/contracts)" icon={FileCode}>
            <p>
              Solidity smart contracts built with <strong className="text-foreground">Foundry</strong> (v0.8.30+),
              deployed on <strong className="text-foreground">Ethereum Sepolia</strong> testnet.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Contracts</h3>

            <h4 className="text-foreground font-medium mt-3">UniverseManager (Factory)</h4>
            <p>
              The entry point for the LOAR protocol. Creates Universe contracts, deploys governance tokens,
              enables hooks and lockers, and manages team fee collection.
            </p>
            <CodeBlock title="Key Functions">{`createUniverse(name, description, image, ...) → address
deployToken(name, symbol, image, context) → (token, governor)
enableHook(universe, hook) / enableLocker(universe, locker)
getUniverse(address) → UniverseData`}</CodeBlock>

            <h4 className="text-foreground font-medium mt-3">Universe (Narrative Container)</h4>
            <p>
              Each universe is a separate contract storing a linked list of <Code>VideoNode</Code> structs.
              Nodes contain content and plot hashes (SHA-256, stored as <Code>bytes32</Code> for gas efficiency).
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
            <p>
              OpenZeppelin Governor pattern. Each universe gets its own governor instance.
            </p>
            <ul className="list-disc list-inside space-y-1">
              <li>Voting delay: 0 (immediate)</li>
              <li>Voting period: 1 hour</li>
              <li>Proposal threshold: 1e18 tokens</li>
              <li>Quorum: 10% of total supply</li>
            </ul>

            <h4 className="text-foreground font-medium mt-3">GovernanceERC20</h4>
            <p>
              ERC20 token with voting capabilities (ERC20Votes). Each universe can deploy its own token.
              Includes metadata fields for name, symbol, image URL, and context string.
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
                ['UniverseManager', '0x7af142BbD14CaEECdA68f948F467Da0257f6B114'],
                ['UniverseTokenDeployer', '0xE34DAB193105F3d7ec6EE4E6172cbE6213108d8B'],
                ['LoarFeeLocker', '0xEB2B470D2A8dD2192e33e94Db4c7Dd9fb937f38f'],
                ['LoarLpLockerMultiple', '0x3E66D6feAEeb68b43E76CF4152154B4F30553ca6'],
                ['LoarHookStaticFee', '0xa66407B5a48C5CbFF4055Ca50f6189575CC2A8cC'],
              ]}
            />
          </Section>

          {/* Indexer */}
          <Section id="indexer" title="Blockchain Indexer (apps/indexer)" icon={Blocks}>
            <p>
              <strong className="text-foreground">Ponder v0.15</strong> indexes smart contract events in real-time
              from Sepolia into a PostgreSQL database, exposing a GraphQL API on port <Code>42069</Code>.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Indexed Contracts & Events</h3>
            <Table
              headers={['Contract', 'Events']}
              rows={[
                ['UniverseManager', 'UniverseCreated, TokenCreated, SetHook'],
                ['Universe (dynamic)', 'NodeCreated, NodeCanonized'],
                ['UniverseGovernor (dynamic)', 'ProposalCreated, ProposalExecuted, ProposalCanceled, VoteCast'],
                ['GovernanceToken (dynamic)', 'Transfer'],
                ['PoolManager (Uniswap v4)', 'Initialize, Swap'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Database Schema</h3>
            <Table
              headers={['Table', 'Description']}
              rows={[
                ['universe', 'Universe metadata (name, description, image, node count, token/governor addresses)'],
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
              LOAR uses a <strong className="text-foreground">unified storage manager</strong> with priority-based
              provider fallback and background redundancy. Content is identified by SHA-256 hash and stored across
              multiple providers for resilience.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Storage Providers</h3>
            <Table
              headers={['Provider', 'Network', 'Use Case']}
              rows={[
                ['Walrus', 'Sui blockchain', 'Primary decentralized storage (default highest priority)'],
                ['IPFS (Pinata)', 'IPFS network', 'Content-addressable storage with pinning service'],
                ['Synapse', 'Filecoin', 'Long-term archival storage'],
                ['Firebase Storage', 'Google Cloud', 'Fast fallback for availability'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">How It Works</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li><strong className="text-foreground">Upload:</strong> Content is hashed (SHA-256) and uploaded to the highest-priority available provider</li>
              <li><strong className="text-foreground">Manifest:</strong> A storage manifest is saved to Firestore mapping the content hash to provider-specific identifiers</li>
              <li><strong className="text-foreground">Redundancy:</strong> Background queue replicates content to additional providers asynchronously</li>
              <li><strong className="text-foreground">Resolution:</strong> <Code>resolve(contentHash)</Code> returns the best available URL by checking providers in priority order</li>
              <li><strong className="text-foreground">On-chain:</strong> Only the <Code>bytes32</Code> content hash is stored on-chain (gas-efficient), full content is in events</li>
            </ol>

            <h3 className="text-foreground font-semibold mt-4">Upload Queue</h3>
            <p>
              The async upload queue uses in-memory job tracking with exponential backoff retry (3 attempts).
              Jobs progress through: <Code>pending</Code> → <Code>processing</Code> → <Code>completed</Code> | <Code>failed</Code>.
            </p>
          </Section>

          {/* Authentication */}
          <Section id="auth" title="Authentication" icon={Shield}>
            <p>
              Authentication uses <strong className="text-foreground">Firebase Auth</strong> for identity management
              with token-based API authorization.
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
                ['apps/web/src/lib/firebase.ts', 'Firebase client SDK initialization'],
                ['apps/web/src/lib/auth-client.ts', 'useAuth() hook, signIn/signUp/signOut helpers'],
                ['apps/server/src/lib/firebase.ts', 'Firebase Admin SDK init (Firestore db + adminAuth)'],
                ['apps/server/src/lib/auth.ts', 'verifyAuth() middleware via Firebase Admin'],
                ['apps/server/src/lib/context.ts', 'Request context with user (DecodedIdToken)'],
              ]}
            />

            <h3 className="text-foreground font-semibold mt-4">Wallet Signature Verification</h3>
            <p>
              Certain operations (e.g., creating a universe) require a wallet signature in addition to Firebase auth.
              The server verifies the signature against a 5-minute timestamp window to prevent replay attacks.
            </p>
          </Section>

          {/* AI Services */}
          <Section id="ai" title="AI Services" icon={Cpu}>
            <p>
              LOAR integrates multiple AI providers for generative media creation, wiki generation, and prompt refinement.
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
                ['Wiki Generation', 'Google Gemini', 'Auto-generate wiki entries from events/videos'],
                ['Storyline Generation', 'Gemini / OpenAI', 'Create narrative storylines from prompts'],
                ['Prompt Improvement', 'Gemini', 'Refine video generation prompts with universe context'],
                ['Video Analysis', 'Gemini', 'Extract narrative content from existing videos'],
              ]}
            />
          </Section>

          {/* Governance */}
          <Section id="governance" title="Governance System" icon={Vote}>
            <p>
              Each Cinematic Universe can have its own <strong className="text-foreground">governance token</strong> and{' '}
              <strong className="text-foreground">governor contract</strong>, enabling decentralized decision-making.
            </p>

            <h3 className="text-foreground font-semibold mt-4">How Governance Works</h3>
            <ol className="list-decimal list-inside space-y-2">
              <li><strong className="text-foreground">Token Deployment:</strong> Universe creator deploys a GovernanceERC20 via UniverseManager</li>
              <li><strong className="text-foreground">Token Distribution:</strong> Tokens can be distributed, traded on Uniswap v4, or earned</li>
              <li><strong className="text-foreground">Proposal Creation:</strong> Any holder with {'>'}= 1e18 tokens can create proposals</li>
              <li><strong className="text-foreground">Voting:</strong> 1-hour voting period, 10% quorum requirement</li>
              <li><strong className="text-foreground">Execution:</strong> Successful proposals are executed on-chain (e.g., canonize a node)</li>
            </ol>

            <h3 className="text-foreground font-semibold mt-4">Governance Actions</h3>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-foreground">Canonize Nodes:</strong> Vote to make a narrative node official/canon</li>
              <li><strong className="text-foreground">Universe Parameters:</strong> Modify creation rules, visibility, whitelists</li>
              <li><strong className="text-foreground">Hook Configuration:</strong> Enable/disable Uniswap v4 hooks</li>
            </ul>

            <h3 className="text-foreground font-semibold mt-4">Uniswap v4 Integration</h3>
            <p>
              Governance tokens can be traded via Uniswap v4 pools with custom <Code>LoarHook</Code> contracts.
              The hooks manage LP fees, protocol fees, and factory-pattern pool creation for each universe's token.
            </p>
          </Section>

          {/* API Reference */}
          <Section id="api" title="API Reference" icon={Network}>
            <h3 className="text-foreground font-semibold">Server API (tRPC)</h3>
            <p>
              The tRPC API is type-safe end-to-end. The client is configured at{' '}
              <Code>apps/web/src/utils/trpc.ts</Code> and auto-includes the Firebase auth token in every request.
            </p>
            <CodeBlock title="tRPC Client Usage">{`import { trpcClient } from '@/utils/trpc';

// Query
const universes = await trpcClient.cinematicUniverses.getAll.query();

// Mutation
const result = await trpcClient.fal.generateImage.mutate({
  prompt: "A cyberpunk cityscape",
  model: "flux",
});`}</CodeBlock>

            <h3 className="text-foreground font-semibold mt-4">Ponder GraphQL API</h3>
            <p>
              The indexer exposes a GraphQL endpoint at <Code>http://localhost:42069</Code> (configurable via{' '}
              <Code>VITE_PONDER_URL</Code>).
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
              Generated Wagmi hooks are exported from <Code>@loar/abis</Code> for type-safe contract interactions.
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
              All environment variables are centralized in a single <Code>.env</Code> file at the monorepo root.
              Vite variables are prefixed with <Code>VITE_</Code> for client-side exposure.
            </p>

            <h3 className="text-foreground font-semibold mt-4">Firebase</h3>
            <Table
              headers={['Variable', 'Description']}
              rows={[
                ['FIREBASE_SERVICE_ACCOUNT', 'Firebase Admin service account JSON (inline or base64)'],
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
                ['WALRUS_PUBLISHER_URL', 'https://publisher.walrus-testnet.walrus.space', 'Walrus publisher endpoint'],
                ['WALRUS_AGGREGATOR_URL', 'https://aggregator.walrus-testnet.walrus.space', 'Walrus aggregator endpoint'],
                ['PINATA_JWT', '', 'Pinata IPFS API token'],
                ['PINATA_GATEWAY_URL', '', 'Pinata IPFS gateway URL'],
                ['STORAGE_PROVIDER_PRIORITY', 'walrus,ipfs,synapse,firebase', 'Provider priority order'],
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
            <p>Each app has its own Dockerfile using multi-stage builds with <Code>node:20-alpine</Code>.</p>
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
              <li><strong className="text-foreground">ci.yml:</strong> Quality checks (format, lint, type-check), builds, and Forge contract tests</li>
              <li><strong className="text-foreground">deploy.yml:</strong> Auto-deploy on push to <Code>main</Code> &mdash; SSH into server, git pull, pnpm install/build, docker compose restart</li>
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
            <p className="mt-1">Sepolia Testnet &middot; loartech.xyz</p>
          </div>
        </main>
      </div>
    </div>
  );
}
