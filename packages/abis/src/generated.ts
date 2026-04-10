import {
  createUseReadContract,
  createUseWriteContract,
  createUseSimulateContract,
  createUseWatchContractEvent,
} from 'wagmi/codegen';

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// CharacterNFT
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const characterNftAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'appearanceFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'characterByName',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'characters',
    outputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'visualHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'appearanceCount', internalType: 'uint256', type: 'uint256' },
      {
        name: 'accumulatedRoyalties',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'visualHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'createCharacter',
    outputs: [{ name: 'characterId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'startId', internalType: 'uint256', type: 'uint256' },
      { name: 'count', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getCharactersByUniverse',
    outputs: [{ name: 'ids', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_universeId', internalType: 'uint256', type: 'uint256' },
      { name: '_platform', internalType: 'address', type: 'address' },
      { name: '_rightsRegistry', internalType: 'address', type: 'address' },
      { name: '_paymentRouter', internalType: 'address', type: 'address' },
      { name: '_appearanceFeeBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextCharacterId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'paymentRouter',
    outputs: [{ name: '', internalType: 'contract IPaymentRouter', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'characterId', internalType: 'uint256', type: 'uint256' },
      { name: 'episodeId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'recordAppearance',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'rightsRegistry',
    outputs: [{ name: '', internalType: 'contract IRightsRegistry', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'salePrice', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'royaltyInfo',
    outputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenByIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'approved',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: '_fromTokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: '_toTokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BatchMetadataUpdate',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'characterId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'episodeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'reward',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CharacterAppearance',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'characterId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'CharacterCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: '_tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'MetadataUpdate',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'characterId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RoyaltyClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Transfer',
  },
  { type: 'error', inputs: [], name: 'CharacterExists' },
  { type: 'error', inputs: [], name: 'ContentNotMonetizable' },
  {
    type: 'error',
    inputs: [
      { name: 'numerator', internalType: 'uint256', type: 'uint256' },
      { name: 'denominator', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC2981InvalidDefaultRoyalty',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC2981InvalidDefaultRoyaltyReceiver',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'numerator', internalType: 'uint256', type: 'uint256' },
      { name: 'denominator', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC2981InvalidTokenRoyalty',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'receiver', internalType: 'address', type: 'address' },
    ],
    name: 'ERC2981InvalidTokenRoyaltyReceiver',
  },
  { type: 'error', inputs: [], name: 'ERC721EnumerableForbiddenBatchMint' },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC721IncorrectOwner',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721InsufficientApproval',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ERC721NonexistentToken',
  },
  {
    type: 'error',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721OutOfBoundsIndex',
  },
  { type: 'error', inputs: [], name: 'FeeTooHigh' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'NotOwner' },
  { type: 'error', inputs: [], name: 'NothingToClaim' },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'WrongUniverse' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// CreditManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const creditManagerAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'FIAT_MARGIN_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'LOAR_MARGIN_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'credits', internalType: 'uint256', type: 'uint256' },
      { name: 'priceWei', internalType: 'uint256', type: 'uint256' },
      { name: 'priceLoar', internalType: 'uint256', type: 'uint256' },
      { name: 'bonusCredits', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'createPackage',
    outputs: [{ name: 'packageId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'packageId', internalType: 'uint256', type: 'uint256' }],
    name: 'deactivatePackage',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    name: 'generationCosts',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'genType', internalType: 'string', type: 'string' }],
    name: 'getGenerationCost',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getUserStats',
    outputs: [
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'totalPurchased', internalType: 'uint256', type: 'uint256' },
      { name: 'totalSpent', internalType: 'uint256', type: 'uint256' },
      { name: 'totalBonusReceived', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'reason', internalType: 'string', type: 'string' },
    ],
    name: 'grantCredits',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'holderDiscountBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_loarToken', internalType: 'address', type: 'address' },
      { name: '_platform', internalType: 'address', type: 'address' },
      { name: '_treasury', internalType: 'address', type: 'address' },
      { name: '_paymentRouter', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextPackageId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'packages',
    outputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'credits', internalType: 'uint256', type: 'uint256' },
      { name: 'priceWei', internalType: 'uint256', type: 'uint256' },
      { name: 'priceLoar', internalType: 'uint256', type: 'uint256' },
      { name: 'bonusCredits', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'paymentRouter',
    outputs: [{ name: '', internalType: 'contract IPaymentRouter', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'packageId', internalType: 'uint256', type: 'uint256' },
      { name: 'discountToken', internalType: 'address', type: 'address' },
    ],
    name: 'purchaseWithEth',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'packageId', internalType: 'uint256', type: 'uint256' }],
    name: 'purchaseWithEth',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'packageId', internalType: 'uint256', type: 'uint256' }],
    name: 'purchaseWithLoar',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'genType', internalType: 'string', type: 'string' },
      { name: 'cost', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setGenerationCost',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'discountBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'setHolderDiscount',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'generationType', internalType: 'string', type: 'string' },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'spendCredits',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newToken', internalType: 'address', type: 'address' }],
    name: 'updateLoarToken',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'userCredits',
    outputs: [
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'totalPurchased', internalType: 'uint256', type: 'uint256' },
      { name: 'totalSpent', internalType: 'uint256', type: 'uint256' },
      { name: 'totalBonusReceived', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'reason',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'CreditsGranted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'packageId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'credits',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'bonus',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'paid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CreditsPurchasedWithEth',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'packageId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'credits',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'bonus',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'loarPaid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CreditsPurchasedWithLoar',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'generationType',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CreditsSpent',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'genType',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'newCost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GenerationCostUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'packageId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'credits',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'priceWei',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'priceLoar',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'PackageCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'InsufficientCredits' },
  { type: 'error', inputs: [], name: 'InsufficientLoarAllowance' },
  { type: 'error', inputs: [], name: 'InsufficientLoarBalance' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'NotPlatform' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'PackageNotActive' },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// EpisodeNFT
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const episodeNftAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'nodeId', internalType: 'uint256', type: 'uint256' },
      { name: 'contentHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'mintPrice', internalType: 'uint256', type: 'uint256' },
      { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'createEpisode',
    outputs: [{ name: 'episodeId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'episodeId', internalType: 'uint256', type: 'uint256' }],
    name: 'deactivateEpisode',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'defaultRoyaltyBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'episodes',
    outputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'nodeId', internalType: 'uint256', type: 'uint256' },
      { name: 'contentHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'mintPrice', internalType: 'uint256', type: 'uint256' },
      { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
      { name: 'minted', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_platform', internalType: 'address', type: 'address' },
      { name: '_rightsRegistry', internalType: 'address', type: 'address' },
      { name: '_paymentRouter', internalType: 'address', type: 'address' },
      { name: '_platformFeeBps', internalType: 'uint16', type: 'uint16' },
      { name: '_defaultRoyaltyBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'episodeId', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenURI_', internalType: 'string', type: 'string' },
    ],
    name: 'mint',
    outputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextEpisodeId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextTokenId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'paymentRouter',
    outputs: [{ name: '', internalType: 'contract IPaymentRouter', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platformFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'recognizedTokens',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'rightsRegistry',
    outputs: [{ name: '', internalType: 'contract IRightsRegistry', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'salePrice', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'royaltyInfo',
    outputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFeeBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setPlatformFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'index', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenByIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenEpisode',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'approved',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: '_fromTokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: '_toTokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BatchMetadataUpdate',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'episodeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'nodeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'mintPrice',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'maxSupply',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'EpisodeCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'episodeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'EpisodeDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'episodeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'price',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'EpisodeMinted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: '_tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'MetadataUpdate',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Transfer',
  },
  { type: 'error', inputs: [], name: 'ContentNotMonetizable' },
  {
    type: 'error',
    inputs: [
      { name: 'numerator', internalType: 'uint256', type: 'uint256' },
      { name: 'denominator', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC2981InvalidDefaultRoyalty',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC2981InvalidDefaultRoyaltyReceiver',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'numerator', internalType: 'uint256', type: 'uint256' },
      { name: 'denominator', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC2981InvalidTokenRoyalty',
  },
  {
    type: 'error',
    inputs: [
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'receiver', internalType: 'address', type: 'address' },
    ],
    name: 'ERC2981InvalidTokenRoyaltyReceiver',
  },
  { type: 'error', inputs: [], name: 'ERC721EnumerableForbiddenBatchMint' },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC721IncorrectOwner',
  },
  {
    type: 'error',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721InsufficientApproval',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'operator', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOperator',
  },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC721InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'ERC721NonexistentToken',
  },
  {
    type: 'error',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC721OutOfBoundsIndex',
  },
  { type: 'error', inputs: [], name: 'EpisodeNotActive' },
  { type: 'error', inputs: [], name: 'FeeTooHigh' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'MaxSupplyReached' },
  { type: 'error', inputs: [], name: 'NotCreator' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GovernanceERC20
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const governanceErc20Abi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_name', internalType: 'string', type: 'string' },
      { name: '_symbol', internalType: 'string', type: 'string' },
      { name: '_maxSupply', internalType: 'uint256', type: 'uint256' },
      { name: '_admin', internalType: 'address', type: 'address' },
      { name: '_imageUrl', internalType: 'string', type: 'string' },
      { name: '_metadata', internalType: 'string', type: 'string' },
      { name: '_context', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'CLOCK_MODE',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'admin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'pos', internalType: 'uint32', type: 'uint32' },
    ],
    name: 'checkpoints',
    outputs: [
      {
        name: '',
        internalType: 'struct Checkpoints.Checkpoint208',
        type: 'tuple',
        components: [
          { name: '_key', internalType: 'uint48', type: 'uint48' },
          { name: '_value', internalType: 'uint208', type: 'uint208' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'clock',
    outputs: [{ name: '', internalType: 'uint48', type: 'uint48' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'context',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'delegatee', internalType: 'address', type: 'address' }],
    name: 'delegate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'delegatee', internalType: 'address', type: 'address' },
      { name: 'nonce', internalType: 'uint256', type: 'uint256' },
      { name: 'expiry', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'delegateBySig',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'delegates',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'timepoint', internalType: 'uint256', type: 'uint256' }],
    name: 'getPastTotalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'timepoint', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getPastVotes',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'getVotes',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'imageUrl',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadata',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'numCheckpoints',
    outputs: [{ name: '', internalType: 'uint32', type: 'uint32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universe',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'delegator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'fromDelegate',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'toDelegate',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'DelegateChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'delegate',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'previousVotes',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newVotes',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'DelegateVotesChanged',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Transfer',
  },
  { type: 'error', inputs: [], name: 'CheckpointUnorderedInsertion' },
  { type: 'error', inputs: [], name: 'ECDSAInvalidSignature' },
  {
    type: 'error',
    inputs: [{ name: 'length', internalType: 'uint256', type: 'uint256' }],
    name: 'ECDSAInvalidSignatureLength',
  },
  {
    type: 'error',
    inputs: [{ name: 's', internalType: 'bytes32', type: 'bytes32' }],
    name: 'ECDSAInvalidSignatureS',
  },
  {
    type: 'error',
    inputs: [
      { name: 'increasedSupply', internalType: 'uint256', type: 'uint256' },
      { name: 'cap', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20ExceededSafeSupply',
  },
  {
    type: 'error',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'allowance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientAllowance',
  },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSpender',
  },
  {
    type: 'error',
    inputs: [{ name: 'deadline', internalType: 'uint256', type: 'uint256' }],
    name: 'ERC2612ExpiredSignature',
  },
  {
    type: 'error',
    inputs: [
      { name: 'signer', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC2612InvalidSigner',
  },
  {
    type: 'error',
    inputs: [
      { name: 'timepoint', internalType: 'uint256', type: 'uint256' },
      { name: 'clock', internalType: 'uint48', type: 'uint48' },
    ],
    name: 'ERC5805FutureLookup',
  },
  { type: 'error', inputs: [], name: 'ERC6372InconsistentClock' },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'currentNonce', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidAccountNonce',
  },
  { type: 'error', inputs: [], name: 'InvalidShortString' },
  {
    type: 'error',
    inputs: [
      { name: 'bits', internalType: 'uint8', type: 'uint8' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SafeCastOverflowedUintDowncast',
  },
  {
    type: 'error',
    inputs: [{ name: 'str', internalType: 'string', type: 'string' }],
    name: 'StringTooLong',
  },
  {
    type: 'error',
    inputs: [{ name: 'expiry', internalType: 'uint256', type: 'uint256' }],
    name: 'VotesExpiredSignature',
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LaunchpadStaking
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const launchpadStakingAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'universeId', internalType: 'uint256', type: 'uint256' }],
    name: 'claimUniverseReward',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'distributeUniverseReward',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'earlyUnstakePenaltyBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getAllocationWeight',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getCurationBoost',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getFeeDiscount',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getUserTier',
    outputs: [{ name: '', internalType: 'enum LaunchpadStaking.Tier', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'hasPriorityAccess',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_loarToken', internalType: 'address', type: 'address' },
      { name: '_treasury', internalType: 'address', type: 'address' },
      { name: '_liquidityPool', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidityPool',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'minLockPeriod',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'pendingUniverseReward',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPenaltyBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setEarlyUnstakePenalty',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPool', internalType: 'address', type: 'address' }],
    name: 'setLiquidityPool',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPeriod', internalType: 'uint256', type: 'uint256' }],
    name: 'setMinLockPeriod',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'tier',
        internalType: 'enum LaunchpadStaking.Tier',
        type: 'uint8',
      },
      { name: 'minStake', internalType: 'uint256', type: 'uint256' },
      { name: 'weight', internalType: 'uint16', type: 'uint16' },
      { name: 'feeDiscountBps', internalType: 'uint16', type: 'uint16' },
      { name: 'curationBoost', internalType: 'uint16', type: 'uint16' },
      { name: 'priorityQueue', internalType: 'bool', type: 'bool' },
    ],
    name: 'setTierConfig',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newTreasury', internalType: 'address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'stakeInUniverse',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'stakes',
    outputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'stakedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'lastClaimAt', internalType: 'uint256', type: 'uint256' },
      {
        name: 'tier',
        internalType: 'enum LaunchpadStaking.Tier',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'enum LaunchpadStaking.Tier', type: 'uint8' }],
    name: 'tierConfigs',
    outputs: [
      { name: 'minStake', internalType: 'uint256', type: 'uint256' },
      { name: 'weight', internalType: 'uint16', type: 'uint16' },
      { name: 'feeDiscountBps', internalType: 'uint16', type: 'uint16' },
      { name: 'curationBoost', internalType: 'uint16', type: 'uint16' },
      { name: 'priorityQueue', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'enum LaunchpadStaking.Tier', type: 'uint8' }],
    name: 'tierCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalPenaltyCollected',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalStaked',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalUniverseStaked',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'universePools',
    outputs: [
      { name: 'totalStaked', internalType: 'uint256', type: 'uint256' },
      { name: 'accRewardPerShare', internalType: 'uint256', type: 'uint256' },
      { name: 'totalDistributed', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'universeStakes',
    outputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'stakedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'rewardDebt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'unstakeFromUniverse',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'wouldIncurPenalty',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'tier',
        internalType: 'enum LaunchpadStaking.Tier',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'Staked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'oldTier',
        internalType: 'enum LaunchpadStaking.Tier',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'newTier',
        internalType: 'enum LaunchpadStaking.Tier',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'TierChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'UniverseRewardClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'UniverseRewardDistributed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'UniverseStaked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'penalty',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'UniverseUnstaked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'penalty',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Unstaked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'InsufficientStake' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'NothingStaked' },
  { type: 'error', inputs: [], name: 'NothingToClaim' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
  { type: 'error', inputs: [], name: 'ZeroAmount' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LoarBurner
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const loarBurnerAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'enum LoarBurner.BurnAction', type: 'uint8' }],
    name: 'actions',
    outputs: [
      { name: 'cost', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'totalBurned', internalType: 'uint256', type: 'uint256' },
      { name: 'totalCount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    name: 'customActions',
    outputs: [
      { name: 'cost', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'totalBurned', internalType: 'uint256', type: 'uint256' },
      { name: 'totalCount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'action',
        internalType: 'enum LoarBurner.BurnAction',
        type: 'uint8',
      },
    ],
    name: 'execute',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'actionName', internalType: 'bytes32', type: 'bytes32' }],
    name: 'executeCustom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      {
        name: 'action',
        internalType: 'enum LoarBurner.BurnAction',
        type: 'uint8',
      },
    ],
    name: 'executeFor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_loarToken', internalType: 'address', type: 'address' },
      { name: '_treasury', internalType: 'address', type: 'address' },
      { name: '_liquidityPool', internalType: 'address', type: 'address' },
      { name: '_platform', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidityPool',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lpRatioBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'action',
        internalType: 'enum LoarBurner.BurnAction',
        type: 'uint8',
      },
      { name: 'cost', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    name: 'setActionConfig',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'actionName', internalType: 'bytes32', type: 'bytes32' },
      { name: 'cost', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    name: 'setCustomAction',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPool', internalType: 'address', type: 'address' }],
    name: 'setLiquidityPool',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newRatio', internalType: 'uint16', type: 'uint16' }],
    name: 'setLpRatio',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPlatform', internalType: 'address', type: 'address' }],
    name: 'setPlatform',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newTreasury', internalType: 'address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalCollected',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalToLp',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'action',
        internalType: 'enum LoarBurner.BurnAction',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'active', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ActionConfigUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'action',
        internalType: 'enum LoarBurner.BurnAction',
        type: 'uint8',
        indexed: true,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'toLp',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'toTreasury',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ActionExecuted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'actionName',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'active', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'CustomActionConfigUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'actionName',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'toLp',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'toTreasury',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CustomActionExecuted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldRatio',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
      {
        name: 'newRatio',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'LpRatioUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'ActionNotActive' },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'InsufficientAllowance' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LoarFeeLocker
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const loarFeeLockerAbi = [
  {
    type: 'constructor',
    inputs: [{ name: 'owner_', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'depositor', internalType: 'address', type: 'address' }],
    name: 'addDepositor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'depositor', internalType: 'address', type: 'address' }],
    name: 'allowedDepositors',
    outputs: [{ name: 'isAllowed', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'feeOwner', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'availableFees',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'feeOwner', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'feesToClaim',
    outputs: [{ name: 'balance', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'depositor', internalType: 'address', type: 'address' }],
    name: 'removeDepositor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'feeOwner', internalType: 'address', type: 'address' },
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'storeFees',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'depositor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AddDepositor',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'feeOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amountClaimed',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ClaimTokens',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'feeOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'recipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'amountClaimed',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ClaimTokensPermissioned',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'depositor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RemoveDepositor',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'feeOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'balance',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'StoreTokens',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'AddressInsufficientBalance',
  },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'NoFeesToClaim' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LoarHookStaticFee
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const loarHookStaticFeeAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_poolManager', internalType: 'address', type: 'address' },
      { name: '_factory', internalType: 'address', type: 'address' },
      { name: '_weth', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'FEE_DENOMINATOR',
    outputs: [{ name: '', internalType: 'int128', type: 'int128' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_LP_FEE',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'PROTOCOL_FEE_NUMERATOR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        internalType: 'struct ModifyLiquidityParams',
        type: 'tuple',
        components: [
          { name: 'tickLower', internalType: 'int24', type: 'int24' },
          { name: 'tickUpper', internalType: 'int24', type: 'int24' },
          { name: 'liquidityDelta', internalType: 'int256', type: 'int256' },
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
        ],
      },
      { name: 'delta', internalType: 'BalanceDelta', type: 'int256' },
      { name: 'feesAccrued', internalType: 'BalanceDelta', type: 'int256' },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'afterAddLiquidity',
    outputs: [
      { name: '', internalType: 'bytes4', type: 'bytes4' },
      { name: '', internalType: 'BalanceDelta', type: 'int256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      { name: 'amount0', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1', internalType: 'uint256', type: 'uint256' },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'afterDonate',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      { name: 'sqrtPriceX96', internalType: 'uint160', type: 'uint160' },
      { name: 'tick', internalType: 'int24', type: 'int24' },
    ],
    name: 'afterInitialize',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        internalType: 'struct ModifyLiquidityParams',
        type: 'tuple',
        components: [
          { name: 'tickLower', internalType: 'int24', type: 'int24' },
          { name: 'tickUpper', internalType: 'int24', type: 'int24' },
          { name: 'liquidityDelta', internalType: 'int256', type: 'int256' },
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
        ],
      },
      { name: 'delta', internalType: 'BalanceDelta', type: 'int256' },
      { name: 'feesAccrued', internalType: 'BalanceDelta', type: 'int256' },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'afterRemoveLiquidity',
    outputs: [
      { name: '', internalType: 'bytes4', type: 'bytes4' },
      { name: '', internalType: 'BalanceDelta', type: 'int256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        internalType: 'struct SwapParams',
        type: 'tuple',
        components: [
          { name: 'zeroForOne', internalType: 'bool', type: 'bool' },
          { name: 'amountSpecified', internalType: 'int256', type: 'int256' },
          {
            name: 'sqrtPriceLimitX96',
            internalType: 'uint160',
            type: 'uint160',
          },
        ],
      },
      { name: 'delta', internalType: 'BalanceDelta', type: 'int256' },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'afterSwap',
    outputs: [
      { name: '', internalType: 'bytes4', type: 'bytes4' },
      { name: '', internalType: 'int128', type: 'int128' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        internalType: 'struct ModifyLiquidityParams',
        type: 'tuple',
        components: [
          { name: 'tickLower', internalType: 'int24', type: 'int24' },
          { name: 'tickUpper', internalType: 'int24', type: 'int24' },
          { name: 'liquidityDelta', internalType: 'int256', type: 'int256' },
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
        ],
      },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'beforeAddLiquidity',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      { name: 'amount0', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1', internalType: 'uint256', type: 'uint256' },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'beforeDonate',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      { name: 'sqrtPriceX96', internalType: 'uint160', type: 'uint160' },
    ],
    name: 'beforeInitialize',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        internalType: 'struct ModifyLiquidityParams',
        type: 'tuple',
        components: [
          { name: 'tickLower', internalType: 'int24', type: 'int24' },
          { name: 'tickUpper', internalType: 'int24', type: 'int24' },
          { name: 'liquidityDelta', internalType: 'int256', type: 'int256' },
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
        ],
      },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'beforeRemoveLiquidity',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      {
        name: 'key',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      {
        name: 'params',
        internalType: 'struct SwapParams',
        type: 'tuple',
        components: [
          { name: 'zeroForOne', internalType: 'bool', type: 'bool' },
          { name: 'amountSpecified', internalType: 'int256', type: 'int256' },
          {
            name: 'sqrtPriceLimitX96',
            internalType: 'uint160',
            type: 'uint160',
          },
        ],
      },
      { name: 'hookData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'beforeSwap',
    outputs: [
      { name: '', internalType: 'bytes4', type: 'bytes4' },
      { name: '', internalType: 'BeforeSwapDelta', type: 'int256' },
      { name: '', internalType: 'uint24', type: 'uint24' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getHookPermissions',
    outputs: [
      {
        name: '',
        internalType: 'struct Hooks.Permissions',
        type: 'tuple',
        components: [
          { name: 'beforeInitialize', internalType: 'bool', type: 'bool' },
          { name: 'afterInitialize', internalType: 'bool', type: 'bool' },
          { name: 'beforeAddLiquidity', internalType: 'bool', type: 'bool' },
          { name: 'afterAddLiquidity', internalType: 'bool', type: 'bool' },
          { name: 'beforeRemoveLiquidity', internalType: 'bool', type: 'bool' },
          { name: 'afterRemoveLiquidity', internalType: 'bool', type: 'bool' },
          { name: 'beforeSwap', internalType: 'bool', type: 'bool' },
          { name: 'afterSwap', internalType: 'bool', type: 'bool' },
          { name: 'beforeDonate', internalType: 'bool', type: 'bool' },
          { name: 'afterDonate', internalType: 'bool', type: 'bool' },
          { name: 'beforeSwapReturnDelta', internalType: 'bool', type: 'bool' },
          { name: 'afterSwapReturnDelta', internalType: 'bool', type: 'bool' },
          {
            name: 'afterAddLiquidityReturnDelta',
            internalType: 'bool',
            type: 'bool',
          },
          {
            name: 'afterRemoveLiquidityReturnDelta',
            internalType: 'bool',
            type: 'bool',
          },
        ],
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: 'loar', internalType: 'address', type: 'address' },
      { name: 'pairedToken', internalType: 'address', type: 'address' },
      { name: 'tickIfToken0IsLoar', internalType: 'int24', type: 'int24' },
      { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
      { name: '_locker', internalType: 'address', type: 'address' },
      { name: 'poolData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'initializePool',
    outputs: [
      {
        name: '',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'PoolId', type: 'bytes32' }],
    name: 'loarFee',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'PoolId', type: 'bytes32' }],
    name: 'pairedFee',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'PoolId', type: 'bytes32' }],
    name: 'poolCreationTimestamp',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'poolManager',
    outputs: [{ name: '', internalType: 'contract IPoolManager', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolFee',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ClaimProtocolFees',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pairedToken',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'loar', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'poolId',
        internalType: 'PoolId',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'tickIfToken0IsLoar',
        internalType: 'int24',
        type: 'int24',
        indexed: false,
      },
      {
        name: 'tickSpacing',
        internalType: 'int24',
        type: 'int24',
        indexed: false,
      },
      {
        name: 'locker',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'PoolCreatedFactory',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pairedToken',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'loar', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'poolId',
        internalType: 'PoolId',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'tickIfToken0IsLoar',
        internalType: 'int24',
        type: 'int24',
        indexed: false,
      },
      {
        name: 'tickSpacing',
        internalType: 'int24',
        type: 'int24',
        indexed: false,
      },
    ],
    name: 'PoolCreatedOpen',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'poolId',
        internalType: 'PoolId',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'loarFee',
        internalType: 'uint24',
        type: 'uint24',
        indexed: false,
      },
      {
        name: 'pairedFee',
        internalType: 'uint24',
        type: 'uint24',
        indexed: false,
      },
    ],
    name: 'PoolInitialized',
  },
  { type: 'error', inputs: [], name: 'ETHPoolNotAllowed' },
  { type: 'error', inputs: [], name: 'HookNotImplemented' },
  { type: 'error', inputs: [], name: 'LoarFeeTooHigh' },
  { type: 'error', inputs: [], name: 'NotPoolManager' },
  { type: 'error', inputs: [], name: 'OnlyFactory' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'PairedFeeTooHigh' },
  { type: 'error', inputs: [], name: 'PastCreationTimestamp' },
  { type: 'error', inputs: [], name: 'UnsupportedInitializePath' },
  { type: 'error', inputs: [], name: 'WethCannotBeLoar' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LoarLpLockerMultiple
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const loarLpLockerMultipleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: 'owner_', internalType: 'address', type: 'address' },
      { name: 'factory_', internalType: 'address', type: 'address' },
      { name: 'feeLocker_', internalType: 'address', type: 'address' },
      { name: 'positionManager_', internalType: 'address', type: 'address' },
      { name: 'permit2_', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'BASIS_POINTS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_LP_POSITIONS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_REWARD_PARTICIPANTS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'collectRewards',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'collectRewardsWithoutUnlock',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'feeLocker',
    outputs: [{ name: '', internalType: 'contract ILoarFeeLocker', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC721Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'permit2',
    outputs: [{ name: '', internalType: 'contract IPermit2', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'lockerConfig',
        internalType: 'struct IUniverseManager.LockerConfig',
        type: 'tuple',
        components: [
          { name: 'locker', internalType: 'address', type: 'address' },
          {
            name: 'rewardAdmins',
            internalType: 'address[]',
            type: 'address[]',
          },
          {
            name: 'rewardRecipients',
            internalType: 'address[]',
            type: 'address[]',
          },
          { name: 'rewardBps', internalType: 'uint16[]', type: 'uint16[]' },
          { name: 'tickLower', internalType: 'int24[]', type: 'int24[]' },
          { name: 'tickUpper', internalType: 'int24[]', type: 'int24[]' },
          { name: 'positionBps', internalType: 'uint16[]', type: 'uint16[]' },
          { name: 'lockerData', internalType: 'bytes', type: 'bytes' },
        ],
      },
      {
        name: 'poolConfig',
        internalType: 'struct IUniverseManager.PoolConfig',
        type: 'tuple',
        components: [
          { name: 'hook', internalType: 'address', type: 'address' },
          { name: 'pairedToken', internalType: 'address', type: 'address' },
          { name: 'tickIfToken0IsLoar', internalType: 'int24', type: 'int24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'poolData', internalType: 'bytes', type: 'bytes' },
        ],
      },
      {
        name: 'poolKey',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      { name: 'poolSupply', internalType: 'uint256', type: 'uint256' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'placeLiquidity',
    outputs: [{ name: 'positionId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'positionManager',
    outputs: [{ name: '', internalType: 'contract IPositionManager', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'tokenRewards',
    outputs: [
      {
        name: '',
        internalType: 'struct ILoarLpLocker.TokenRewardInfo',
        type: 'tuple',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          {
            name: 'poolKey',
            internalType: 'struct PoolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', internalType: 'Currency', type: 'address' },
              { name: 'currency1', internalType: 'Currency', type: 'address' },
              { name: 'fee', internalType: 'uint24', type: 'uint24' },
              { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
              {
                name: 'hooks',
                internalType: 'contract IHooks',
                type: 'address',
              },
            ],
          },
          { name: 'positionId', internalType: 'uint256', type: 'uint256' },
          { name: 'numPositions', internalType: 'uint256', type: 'uint256' },
          { name: 'rewardBps', internalType: 'uint16[]', type: 'uint16[]' },
          {
            name: 'rewardAdmins',
            internalType: 'address[]',
            type: 'address[]',
          },
          {
            name: 'rewardRecipients',
            internalType: 'address[]',
            type: 'address[]',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'rewardIndex', internalType: 'uint256', type: 'uint256' },
      { name: 'newAdmin', internalType: 'address', type: 'address' },
    ],
    name: 'updateRewardAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'rewardIndex', internalType: 'uint256', type: 'uint256' },
      { name: 'newRecipient', internalType: 'address', type: 'address' },
    ],
    name: 'updateRewardRecipient',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'version',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'recipient', internalType: 'address', type: 'address' },
    ],
    name: 'withdrawERC20',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'recipient', internalType: 'address', type: 'address' }],
    name: 'withdrawETH',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount0',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amount1',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'rewards0',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'rewards1',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'ClaimedRewards',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'positionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Received',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'rewardIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'oldAdmin',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newAdmin',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'RewardAdminUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'rewardIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'oldRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'RewardRecipientUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'poolKey',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
        indexed: false,
      },
      {
        name: 'poolSupply',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'positionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'numPositions',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'rewardBps',
        internalType: 'uint16[]',
        type: 'uint16[]',
        indexed: false,
      },
      {
        name: 'rewardAdmins',
        internalType: 'address[]',
        type: 'address[]',
        indexed: false,
      },
      {
        name: 'rewardRecipients',
        internalType: 'address[]',
        type: 'address[]',
        indexed: false,
      },
      {
        name: 'tickLower',
        internalType: 'int24[]',
        type: 'int24[]',
        indexed: false,
      },
      {
        name: 'tickUpper',
        internalType: 'int24[]',
        type: 'int24[]',
        indexed: false,
      },
      {
        name: 'positionBps',
        internalType: 'uint16[]',
        type: 'uint16[]',
        indexed: false,
      },
    ],
    name: 'TokenRewardAdded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'AddressInsufficientBalance',
  },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'InvalidPositionBps' },
  { type: 'error', inputs: [], name: 'InvalidRewardBps' },
  { type: 'error', inputs: [], name: 'MismatchedPositionInfos' },
  { type: 'error', inputs: [], name: 'MismatchedRewardArrays' },
  { type: 'error', inputs: [], name: 'NoPositions' },
  { type: 'error', inputs: [], name: 'NoRewardRecipients' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  { type: 'error', inputs: [], name: 'TickRangeLowerThanStartingTick' },
  { type: 'error', inputs: [], name: 'TicksBackwards' },
  { type: 'error', inputs: [], name: 'TicksNotMultipleOfTickSpacing' },
  { type: 'error', inputs: [], name: 'TicksOutOfTickBounds' },
  { type: 'error', inputs: [], name: 'TokenAlreadyHasRewards' },
  { type: 'error', inputs: [], name: 'TooManyPositions' },
  { type: 'error', inputs: [], name: 'TooManyRewardParticipants' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'ZeroRewardAddress' },
  { type: 'error', inputs: [], name: 'ZeroRewardAmount' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LoarToken
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const loarTokenAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_treasury', internalType: 'address', type: 'address' },
      { name: '_initialHolder', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'BPS_DENOMINATOR',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DOMAIN_SEPARATOR',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_INCREASE_PER_CHANGE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_SUPPLY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_TRANSFER_FEE_BPS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'accounts', internalType: 'address[]', type: 'address[]' },
      { name: 'exempt', internalType: 'bool', type: 'bool' },
    ],
    name: 'batchSetFeeExempt',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'value', internalType: 'uint256', type: 'uint256' }],
    name: 'burn',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'burnFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'feeExempt',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidityPool',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'minters',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'exempt', internalType: 'bool', type: 'bool' },
    ],
    name: 'setFeeExempt',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPool', internalType: 'address', type: 'address' }],
    name: 'setLiquidityPool',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'minter', internalType: 'address', type: 'address' },
      { name: 'authorized', internalType: 'bool', type: 'bool' },
    ],
    name: 'setMinter',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFeeBps', internalType: 'uint256', type: 'uint256' }],
    name: 'setTransferFeeBps',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newTreasury', internalType: 'address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'transferFeeBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Approval',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'exempt', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'FeeExemptUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'fee', internalType: 'uint256', type: 'uint256', indexed: false },
    ],
    name: 'LiquidityFeeCollected',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldPool',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newPool',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'LiquidityPoolUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'minter',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'authorized',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'MinterUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Transfer',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldFeeBps',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newFeeBps',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferFeeUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'TreasuryUpdated',
  },
  { type: 'error', inputs: [], name: 'ECDSAInvalidSignature' },
  {
    type: 'error',
    inputs: [{ name: 'length', internalType: 'uint256', type: 'uint256' }],
    name: 'ECDSAInvalidSignatureLength',
  },
  {
    type: 'error',
    inputs: [{ name: 's', internalType: 'bytes32', type: 'bytes32' }],
    name: 'ECDSAInvalidSignatureS',
  },
  {
    type: 'error',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'allowance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientAllowance',
  },
  {
    type: 'error',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'balance', internalType: 'uint256', type: 'uint256' },
      { name: 'needed', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ERC20InsufficientBalance',
  },
  {
    type: 'error',
    inputs: [{ name: 'approver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidApprover',
  },
  {
    type: 'error',
    inputs: [{ name: 'receiver', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidReceiver',
  },
  {
    type: 'error',
    inputs: [{ name: 'sender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSender',
  },
  {
    type: 'error',
    inputs: [{ name: 'spender', internalType: 'address', type: 'address' }],
    name: 'ERC20InvalidSpender',
  },
  {
    type: 'error',
    inputs: [{ name: 'deadline', internalType: 'uint256', type: 'uint256' }],
    name: 'ERC2612ExpiredSignature',
  },
  {
    type: 'error',
    inputs: [
      { name: 'signer', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'ERC2612InvalidSigner',
  },
  { type: 'error', inputs: [], name: 'ExceedsMaxSupply' },
  { type: 'error', inputs: [], name: 'FeeIncreaseExceedsLimit' },
  { type: 'error', inputs: [], name: 'FeeTooHigh' },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'currentNonce', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidAccountNonce',
  },
  { type: 'error', inputs: [], name: 'InvalidShortString' },
  { type: 'error', inputs: [], name: 'NotMinter' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  {
    type: 'error',
    inputs: [{ name: 'str', internalType: 'string', type: 'string' }],
    name: 'StringTooLong',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// PaymentRouter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const paymentRouterAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'USE_DEFAULT_FEE',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claim',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimLoar',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'claimable',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'claimableLoar',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'defaultPlatformFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_treasury', internalType: 'address', type: 'address' },
      {
        name: '_defaultPlatformFeeBps',
        internalType: 'uint16',
        type: 'uint16',
      },
      { name: '_loarToken', internalType: 'address', type: 'address' },
      { name: '_loarFeeDiscountBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarFeeDiscountBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'feeBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'route',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'feeBps', internalType: 'uint16', type: 'uint16' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'routeLoar',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'routeLoarToTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'routeToTreasury',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFeeBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setDefaultFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newDiscountBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setLoarFeeDiscount',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_loarToken', internalType: 'address', type: 'address' }],
    name: 'setLoarToken',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newTreasury', internalType: 'address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Claimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newFeeBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'DefaultFeeUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LoarClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newDiscountBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'LoarFeeDiscountUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creatorAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'platformAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'feeBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'LoarPaymentRouted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newToken',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'LoarTokenUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creatorAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'platformAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'feeBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'PaymentRouted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'TreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'FeeTooHigh' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'NothingToClaim' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// RemixFees
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const remixFeesAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'remixer', internalType: 'address', type: 'address' },
      { name: 'originalCreator', internalType: 'address', type: 'address' },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'chargeRemixFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'creatorShareBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'defaultRemixFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'universeId', internalType: 'uint256', type: 'uint256' }],
    name: 'getRemixFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_loarToken', internalType: 'address', type: 'address' },
      { name: '_treasury', internalType: 'address', type: 'address' },
      { name: '_liquidityPool', internalType: 'address', type: 'address' },
      { name: '_platform', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidityPool',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lpShareBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'minRemixFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'creator', internalType: 'address', type: 'address' },
    ],
    name: 'registerUniverse',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFee', internalType: 'uint256', type: 'uint256' }],
    name: 'setDefaultRemixFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPool', internalType: 'address', type: 'address' }],
    name: 'setLiquidityPool',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newMin', internalType: 'uint256', type: 'uint256' }],
    name: 'setMinRemixFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPlatform', internalType: 'address', type: 'address' }],
    name: 'setPlatform',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_creator', internalType: 'uint16', type: 'uint16' },
      { name: '_lp', internalType: 'uint16', type: 'uint16' },
      { name: '_treasury', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'setSplitRatios',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newTreasury', internalType: 'address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'fee', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setUniverseRemixFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalRemixFees',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalRemixes',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalToCreators',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalToLp',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasuryShareBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'universeConfigs',
    outputs: [
      { name: 'fee', internalType: 'uint256', type: 'uint256' },
      { name: 'customFee', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'universeCreators',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'DefaultRemixFeeUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'remixer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'originalCreator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'fee', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'toCreator',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'toLp',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'toTreasury',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RemixFeeCharged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'fee', internalType: 'uint256', type: 'uint256', indexed: false },
    ],
    name: 'UniverseRemixFeeSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'FeeBelowMinimum' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotCreatorOrPlatform' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SlopMarket
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const slopMarketAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_platform', internalType: 'address', type: 'address' },
      { name: '_paymentRouter', internalType: 'address', type: 'address' },
      { name: '_rightsRegistry', internalType: 'address', type: 'address' },
      { name: '_platformFeeBps', internalType: 'uint16', type: 'uint16' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'activeERC721Listing',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'listingId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'buy',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'delist',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    name: 'getListing',
    outputs: [
      {
        name: '',
        internalType: 'struct SlopMarket.Listing',
        type: 'tuple',
        components: [
          { name: 'seller', internalType: 'address', type: 'address' },
          { name: 'tokenContract', internalType: 'address', type: 'address' },
          { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
          {
            name: 'standard',
            internalType: 'enum SlopMarket.TokenStandard',
            type: 'uint8',
          },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
          { name: 'pricePerUnit', internalType: 'uint256', type: 'uint256' },
          { name: 'active', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'seller', internalType: 'address', type: 'address' }],
    name: 'getSellerListings',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenContract', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'pricePerUnit', internalType: 'uint256', type: 'uint256' },
      { name: 'contentHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'list',
    outputs: [{ name: 'listingId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'listings',
    outputs: [
      { name: 'seller', internalType: 'address', type: 'address' },
      { name: 'tokenContract', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'standard',
        internalType: 'enum SlopMarket.TokenStandard',
        type: 'uint8',
      },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'pricePerUnit', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextListingId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'paymentRouter',
    outputs: [{ name: '', internalType: 'contract IPaymentRouter', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platformFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'rightsRegistry',
    outputs: [{ name: '', internalType: 'contract IRightsRegistry', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newRouter', internalType: 'address', type: 'address' }],
    name: 'setPaymentRouter',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFeeBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setPlatformFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'listingId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'Delisted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'listingId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'seller',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenContract',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'standard',
        internalType: 'enum SlopMarket.TokenStandard',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'pricePerUnit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Listed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newFeeBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'PlatformFeeUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'listingId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'totalPaid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Sale',
  },
  { type: 'error', inputs: [], name: 'AlreadyListed' },
  { type: 'error', inputs: [], name: 'ContentNotMonetizable' },
  { type: 'error', inputs: [], name: 'FeeTooHigh' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidAmount' },
  { type: 'error', inputs: [], name: 'ListingNotActive' },
  { type: 'error', inputs: [], name: 'NotApproved' },
  { type: 'error', inputs: [], name: 'NotEnoughStock' },
  { type: 'error', inputs: [], name: 'NotSeller' },
  { type: 'error', inputs: [], name: 'NotTokenOwner' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'RefundFailed' },
  { type: 'error', inputs: [], name: 'UnsupportedTokenStandard' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// StoryBounties
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const storyBountiesAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_DEADLINE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'bountyId', internalType: 'uint256', type: 'uint256' },
      { name: 'winner', internalType: 'address', type: 'address' },
      { name: 'submissionHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'awardBounty',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'bounties',
    outputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'poster', internalType: 'address', type: 'address' },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'reward', internalType: 'uint256', type: 'uint256' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'descriptionHash', internalType: 'string', type: 'string' },
      { name: 'contentType', internalType: 'string', type: 'string' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      {
        name: 'status',
        internalType: 'enum StoryBounties.BountyStatus',
        type: 'uint8',
      },
      { name: 'claimedBy', internalType: 'address', type: 'address' },
      { name: 'submissionHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'createdAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'bountyId', internalType: 'uint256', type: 'uint256' }],
    name: 'cancelBounty',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancellationFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'reward', internalType: 'uint256', type: 'uint256' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'descriptionHash', internalType: 'string', type: 'string' },
      { name: 'contentType', internalType: 'string', type: 'string' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'createBounty',
    outputs: [{ name: 'bountyId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'bountyId', internalType: 'uint256', type: 'uint256' }],
    name: 'expireBounty',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'bountyId', internalType: 'uint256', type: 'uint256' }],
    name: 'getBounty',
    outputs: [
      {
        name: '',
        internalType: 'struct StoryBounties.Bounty',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'poster', internalType: 'address', type: 'address' },
          { name: 'universeId', internalType: 'uint256', type: 'uint256' },
          { name: 'reward', internalType: 'uint256', type: 'uint256' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'descriptionHash', internalType: 'string', type: 'string' },
          { name: 'contentType', internalType: 'string', type: 'string' },
          { name: 'deadline', internalType: 'uint256', type: 'uint256' },
          {
            name: 'status',
            internalType: 'enum StoryBounties.BountyStatus',
            type: 'uint8',
          },
          { name: 'claimedBy', internalType: 'address', type: 'address' },
          { name: 'submissionHash', internalType: 'bytes32', type: 'bytes32' },
          { name: 'createdAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'universeId', internalType: 'uint256', type: 'uint256' }],
    name: 'getUniverseBounties',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_loarToken', internalType: 'address', type: 'address' },
      { name: '_treasury', internalType: 'address', type: 'address' },
      { name: '_platform', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'loarToken',
    outputs: [{ name: '', internalType: 'contract IERC20', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'minBountyAmount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextBountyId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platformFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFeeBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setCancellationFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newMin', internalType: 'uint256', type: 'uint256' }],
    name: 'setMinBountyAmount',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newPlatform', internalType: 'address', type: 'address' }],
    name: 'setPlatform',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newFeeBps', internalType: 'uint16', type: 'uint16' }],
    name: 'setPlatformFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newTreasury', internalType: 'address', type: 'address' }],
    name: 'setTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalBounties',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalDistributed',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'treasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'universeBounties',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'bountyId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'refund',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'fee', internalType: 'uint256', type: 'uint256', indexed: false },
    ],
    name: 'BountyCancelled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'bountyId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'winner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'reward',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'platformFee',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BountyClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'bountyId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'poster',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'reward',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'contentType',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'BountyCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'bountyId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'BountyExpired',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  { type: 'error', inputs: [], name: 'AmountTooLow' },
  { type: 'error', inputs: [], name: 'BountyNotOpen' },
  { type: 'error', inputs: [], name: 'DeadlineNotPassed' },
  { type: 'error', inputs: [], name: 'DeadlinePassed' },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'InvalidDeadline' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'NotPoster' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// SubscriptionManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const subscriptionManagerAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_FEE_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'UPGRADE_INTERFACE_VERSION',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'universeId', internalType: 'uint256', type: 'uint256' }],
    name: 'cancelSubscription',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'tier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
      { name: 'pricePerMonth', internalType: 'uint256', type: 'uint256' },
      { name: 'earlyAccess', internalType: 'bool', type: 'bool' },
      { name: 'votingBoost', internalType: 'bool', type: 'bool' },
      { name: 'premiumContent', internalType: 'bool', type: 'bool' },
      { name: 'behindTheScenes', internalType: 'bool', type: 'bool' },
      { name: 'creditBonus', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'configureTier',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getSubscription',
    outputs: [
      {
        name: 'tier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'autoRenew', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'minTier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
    ],
    name: 'hasAccess',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_platform', internalType: 'address', type: 'address' },
      { name: '_paymentRouter', internalType: 'address', type: 'address' },
      { name: '_platformFeeBps', internalType: 'uint16', type: 'uint16' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'paymentRouter',
    outputs: [{ name: '', internalType: 'contract IPaymentRouter', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platform',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'platformFeeBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'creator', internalType: 'address', type: 'address' },
    ],
    name: 'registerUniverse',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'tier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
      { name: 'months', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'subscribe',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      {
        name: '',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
    ],
    name: 'subscriberCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'subscriptions',
    outputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'tier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
      { name: 'startedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
      { name: 'autoRenew', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      {
        name: '',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
      },
    ],
    name: 'tierConfigs',
    outputs: [
      { name: 'pricePerMonth', internalType: 'uint256', type: 'uint256' },
      { name: 'earlyAccess', internalType: 'bool', type: 'bool' },
      { name: 'votingBoost', internalType: 'bool', type: 'bool' },
      { name: 'premiumContent', internalType: 'bool', type: 'bool' },
      { name: 'behindTheScenes', internalType: 'bool', type: 'bool' },
      { name: 'creditBonus', internalType: 'uint16', type: 'uint16' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'universeCreators',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'version',
        internalType: 'uint64',
        type: 'uint64',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'tier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'expiresAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Subscribed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'SubscriptionCancelled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'newExpiry',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'SubscriptionRenewed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'tier',
        internalType: 'enum SubscriptionManager.SubscriptionTier',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'pricePerMonth',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TierConfigured',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'UniverseRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  { type: 'error', inputs: [], name: 'AlreadySubscribed' },
  {
    type: 'error',
    inputs: [{ name: 'implementation', internalType: 'address', type: 'address' }],
    name: 'ERC1967InvalidImplementation',
  },
  { type: 'error', inputs: [], name: 'ERC1967NonPayable' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'FeeTooHigh' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidInitialization' },
  { type: 'error', inputs: [], name: 'InvalidTier' },
  { type: 'error', inputs: [], name: 'MonthsTooHigh' },
  { type: 'error', inputs: [], name: 'NoActiveSubscription' },
  { type: 'error', inputs: [], name: 'NoRevenue' },
  { type: 'error', inputs: [], name: 'NotCreator' },
  { type: 'error', inputs: [], name: 'NotInitializing' },
  { type: 'error', inputs: [], name: 'NotPlatform' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'ReentrancyGuardReentrantCall' },
  { type: 'error', inputs: [], name: 'TierNotActive' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'UUPSUnauthorizedCallContext' },
  {
    type: 'error',
    inputs: [{ name: 'slot', internalType: 'bytes32', type: 'bytes32' }],
    name: 'UUPSUnsupportedProxiableUUID',
  },
  { type: 'error', inputs: [], name: 'ZeroAddress' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Universe
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const universeAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'config',
        internalType: 'struct IUniverseManager.UniverseConfig',
        type: 'tuple',
        components: [
          {
            name: 'nodeCreationOption',
            internalType: 'enum NodeCreationOptions',
            type: 'uint8',
          },
          {
            name: 'nodeVisibilityOption',
            internalType: 'enum NodeVisibilityOptions',
            type: 'uint8',
          },
          { name: 'universeAdmin', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'imageURL', internalType: 'string', type: 'string' },
          { name: 'description', internalType: 'string', type: 'string' },
          { name: 'universeManager', internalType: 'address', type: 'address' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'associatedToken',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_contentHash', internalType: 'bytes32', type: 'bytes32' },
      { name: '_plotHash', internalType: 'bytes32', type: 'bytes32' },
      { name: '_previous', internalType: 'uint256', type: 'uint256' },
      { name: '_link', internalType: 'string', type: 'string' },
      { name: '_plot', internalType: 'string', type: 'string' },
    ],
    name: 'createNode',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'currentCanonId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getAdmin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getCanonChain',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getFullGraph',
    outputs: [
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'contentHashes', internalType: 'bytes32[]', type: 'bytes32[]' },
      { name: 'plotHashes', internalType: 'bytes32[]', type: 'bytes32[]' },
      { name: 'previousIds', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'nextIds', internalType: 'uint256[][]', type: 'uint256[][]' },
      { name: 'canonFlags', internalType: 'bool[]', type: 'bool[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getLeaves',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'getMedia',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'getNode',
    outputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes32', type: 'bytes32' },
      { name: '', internalType: 'bytes32', type: 'bytes32' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256[]', type: 'uint256[]' },
      { name: '', internalType: 'bool', type: 'bool' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'fromId', internalType: 'uint256', type: 'uint256' }],
    name: 'getTimeline',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getToken',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getVaultWhitelisted',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'getWhitelisted',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'latestNodeId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'nodeIDToHex',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'nodes',
    outputs: [
      { name: 'contentHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'plotHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'previous', internalType: 'uint256', type: 'uint256' },
      { name: 'canon', internalType: 'bool', type: 'bool' },
      { name: 'creator', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newAdmin', internalType: 'address', type: 'address' }],
    name: 'setAdmin',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'setCanon',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: '_contentHash', internalType: 'bytes32', type: 'bytes32' },
      { name: '_link', internalType: 'string', type: 'string' },
    ],
    name: 'setMedia',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: '_option',
        internalType: 'enum NodeCreationOptions',
        type: 'uint8',
      },
    ],
    name: 'setNodeCreationOption',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: '_option',
        internalType: 'enum NodeVisibilityOptions',
        type: 'uint8',
      },
    ],
    name: 'setNodeVisibilityOption',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'setToken',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'status', internalType: 'bool', type: 'bool' },
    ],
    name: 'setVaultWhitelisted',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'status', internalType: 'bool', type: 'bool' },
    ],
    name: 'setWhitelisted',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeAdmin',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeDescription',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeImageUrl',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeManager',
    outputs: [{ name: '', internalType: 'contract IUniverseManager', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeName',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'vaultWhitelisted',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newAdmin',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AdminUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'nodeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'updater',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'contentHash',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      { name: 'link', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'MediaUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'canonizer',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'NodeCanonized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      {
        name: 'previous',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'contentHash',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'plotHash',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      { name: 'link', internalType: 'string', type: 'string', indexed: false },
      { name: 'plot', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'NodeCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'option',
        internalType: 'enum NodeCreationOptions',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'NodeCreationOptionUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'option',
        internalType: 'enum NodeVisibilityOptions',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'NodeVisibilityOptionUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'TokenUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      { name: 'status', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'VaultWhitelistUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      { name: 'status', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'WhitelistedUpdated',
  },
  {
    type: 'error',
    inputs: [{ name: 'caller', internalType: 'address', type: 'address' }],
    name: 'CallerNotAdmin',
  },
  { type: 'error', inputs: [], name: 'CallerNotManager' },
  { type: 'error', inputs: [], name: 'CanonNotSet' },
  { type: 'error', inputs: [], name: 'NodeDoesNotExist' },
  { type: 'error', inputs: [], name: 'TokenDoesNotExist' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// UniverseGovernor
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const universeGovernorAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_token', internalType: 'contract IVotes', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'BALLOT_TYPEHASH',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'CLOCK_MODE',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'COUNTING_MODE',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'EXTENDED_BALLOT_TYPEHASH',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targets', internalType: 'address[]', type: 'address[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'calldatas', internalType: 'bytes[]', type: 'bytes[]' },
      { name: 'descriptionHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'cancel',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      { name: 'support', internalType: 'uint8', type: 'uint8' },
    ],
    name: 'castVote',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      { name: 'support', internalType: 'uint8', type: 'uint8' },
      { name: 'voter', internalType: 'address', type: 'address' },
      { name: 'signature', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'castVoteBySig',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      { name: 'support', internalType: 'uint8', type: 'uint8' },
      { name: 'reason', internalType: 'string', type: 'string' },
    ],
    name: 'castVoteWithReason',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      { name: 'support', internalType: 'uint8', type: 'uint8' },
      { name: 'reason', internalType: 'string', type: 'string' },
      { name: 'params', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'castVoteWithReasonAndParams',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      { name: 'support', internalType: 'uint8', type: 'uint8' },
      { name: 'voter', internalType: 'address', type: 'address' },
      { name: 'reason', internalType: 'string', type: 'string' },
      { name: 'params', internalType: 'bytes', type: 'bytes' },
      { name: 'signature', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'castVoteWithReasonAndParamsBySig',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'clock',
    outputs: [{ name: '', internalType: 'uint48', type: 'uint48' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'eip712Domain',
    outputs: [
      { name: 'fields', internalType: 'bytes1', type: 'bytes1' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'version', internalType: 'string', type: 'string' },
      { name: 'chainId', internalType: 'uint256', type: 'uint256' },
      { name: 'verifyingContract', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'extensions', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targets', internalType: 'address[]', type: 'address[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'calldatas', internalType: 'bytes[]', type: 'bytes[]' },
      { name: 'descriptionHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'execute',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'timepoint', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getVotes',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'timepoint', internalType: 'uint256', type: 'uint256' },
      { name: 'params', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'getVotesWithParams',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'hasVoted',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targets', internalType: 'address[]', type: 'address[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'calldatas', internalType: 'bytes[]', type: 'bytes[]' },
      { name: 'descriptionHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'hashProposal',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'nonces',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256[]', type: 'uint256[]' },
      { name: '', internalType: 'uint256[]', type: 'uint256[]' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155BatchReceived',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC721Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalDeadline',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalEta',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalNeedsQueuing',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalProposer',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalSnapshot',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proposalThreshold',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'proposalVotes',
    outputs: [
      { name: 'againstVotes', internalType: 'uint256', type: 'uint256' },
      { name: 'forVotes', internalType: 'uint256', type: 'uint256' },
      { name: 'abstainVotes', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targets', internalType: 'address[]', type: 'address[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'calldatas', internalType: 'bytes[]', type: 'bytes[]' },
      { name: 'description', internalType: 'string', type: 'string' },
    ],
    name: 'propose',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targets', internalType: 'address[]', type: 'address[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'calldatas', internalType: 'bytes[]', type: 'bytes[]' },
      { name: 'descriptionHash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'queue',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'timepoint', internalType: 'uint256', type: 'uint256' }],
    name: 'quorum',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'quorumDenominator',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'timepoint', internalType: 'uint256', type: 'uint256' }],
    name: 'quorumNumerator',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'quorumNumerator',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'target', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'relay',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'newProposalThreshold',
        internalType: 'uint256',
        type: 'uint256',
      },
    ],
    name: 'setProposalThreshold',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVotingDelay', internalType: 'uint48', type: 'uint48' }],
    name: 'setVotingDelay',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVotingPeriod', internalType: 'uint32', type: 'uint32' }],
    name: 'setVotingPeriod',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'state',
    outputs: [{ name: '', internalType: 'enum IGovernor.ProposalState', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'token',
    outputs: [{ name: '', internalType: 'contract IERC5805', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newQuorumNumerator', internalType: 'uint256', type: 'uint256' }],
    name: 'updateQuorumNumerator',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'version',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'votingDelay',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'votingPeriod',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'EIP712DomainChanged' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ProposalCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'proposer',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'targets',
        internalType: 'address[]',
        type: 'address[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'signatures',
        internalType: 'string[]',
        type: 'string[]',
        indexed: false,
      },
      {
        name: 'calldatas',
        internalType: 'bytes[]',
        type: 'bytes[]',
        indexed: false,
      },
      {
        name: 'voteStart',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'voteEnd',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'description',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'ProposalCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ProposalExecuted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'etaSeconds',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ProposalQueued',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldProposalThreshold',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newProposalThreshold',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ProposalThresholdSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldQuorumNumerator',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newQuorumNumerator',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'QuorumNumeratorUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'voter',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'support', internalType: 'uint8', type: 'uint8', indexed: false },
      {
        name: 'weight',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'reason',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'VoteCast',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'voter',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'proposalId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'support', internalType: 'uint8', type: 'uint8', indexed: false },
      {
        name: 'weight',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'reason',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      { name: 'params', internalType: 'bytes', type: 'bytes', indexed: false },
    ],
    name: 'VoteCastWithParams',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldVotingDelay',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newVotingDelay',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VotingDelaySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldVotingPeriod',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newVotingPeriod',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VotingPeriodSet',
  },
  { type: 'error', inputs: [], name: 'CheckpointUnorderedInsertion' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  {
    type: 'error',
    inputs: [{ name: 'voter', internalType: 'address', type: 'address' }],
    name: 'GovernorAlreadyCastVote',
  },
  {
    type: 'error',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'GovernorAlreadyQueuedProposal',
  },
  { type: 'error', inputs: [], name: 'GovernorDisabledDeposit' },
  {
    type: 'error',
    inputs: [
      { name: 'proposer', internalType: 'address', type: 'address' },
      { name: 'votes', internalType: 'uint256', type: 'uint256' },
      { name: 'threshold', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'GovernorInsufficientProposerVotes',
  },
  {
    type: 'error',
    inputs: [
      { name: 'targets', internalType: 'uint256', type: 'uint256' },
      { name: 'calldatas', internalType: 'uint256', type: 'uint256' },
      { name: 'values', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'GovernorInvalidProposalLength',
  },
  {
    type: 'error',
    inputs: [
      { name: 'quorumNumerator', internalType: 'uint256', type: 'uint256' },
      { name: 'quorumDenominator', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'GovernorInvalidQuorumFraction',
  },
  {
    type: 'error',
    inputs: [{ name: 'voter', internalType: 'address', type: 'address' }],
    name: 'GovernorInvalidSignature',
  },
  { type: 'error', inputs: [], name: 'GovernorInvalidVoteType' },
  {
    type: 'error',
    inputs: [{ name: 'votingPeriod', internalType: 'uint256', type: 'uint256' }],
    name: 'GovernorInvalidVotingPeriod',
  },
  {
    type: 'error',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'GovernorNonexistentProposal',
  },
  {
    type: 'error',
    inputs: [{ name: 'proposalId', internalType: 'uint256', type: 'uint256' }],
    name: 'GovernorNotQueuedProposal',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'GovernorOnlyExecutor',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'GovernorOnlyProposer',
  },
  { type: 'error', inputs: [], name: 'GovernorQueueNotImplemented' },
  {
    type: 'error',
    inputs: [{ name: 'proposer', internalType: 'address', type: 'address' }],
    name: 'GovernorRestrictedProposer',
  },
  {
    type: 'error',
    inputs: [
      { name: 'proposalId', internalType: 'uint256', type: 'uint256' },
      {
        name: 'current',
        internalType: 'enum IGovernor.ProposalState',
        type: 'uint8',
      },
      { name: 'expectedStates', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'GovernorUnexpectedProposalState',
  },
  {
    type: 'error',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'currentNonce', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'InvalidAccountNonce',
  },
  { type: 'error', inputs: [], name: 'InvalidShortString' },
  { type: 'error', inputs: [], name: 'QueueEmpty' },
  { type: 'error', inputs: [], name: 'QueueFull' },
  {
    type: 'error',
    inputs: [
      { name: 'bits', internalType: 'uint8', type: 'uint8' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SafeCastOverflowedUintDowncast',
  },
  {
    type: 'error',
    inputs: [{ name: 'str', internalType: 'string', type: 'string' }],
    name: 'StringTooLong',
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// UniverseManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const universeManagerAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_teamFeeRecipient', internalType: 'address', type: 'address' },
      { name: '_lpRecipient', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'BPS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MINT_FEE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'TOKEN_SUPPLY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'recipient', internalType: 'address', type: 'address' }],
    name: 'claimEth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'claimTeamFee',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'consumeCreditFund',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'imageURL', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      {
        name: 'nodeCreationOptions',
        internalType: 'enum NodeCreationOptions',
        type: 'uint8',
      },
      {
        name: 'nodeVisibilityOptions',
        internalType: 'enum NodeVisibilityOptions',
        type: 'uint8',
      },
      { name: 'initialOwner', internalType: 'address', type: 'address' },
    ],
    name: 'createUniverse',
    outputs: [
      { name: '_id', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'deploymentConfig',
        internalType: 'struct IUniverseManager.DeploymentConfig',
        type: 'tuple',
        components: [
          {
            name: 'tokenConfig',
            internalType: 'struct IUniverseManager.TokenConfig',
            type: 'tuple',
            components: [
              { name: 'tokenAdmin', internalType: 'address', type: 'address' },
              { name: 'name', internalType: 'string', type: 'string' },
              { name: 'symbol', internalType: 'string', type: 'string' },
              { name: 'imageURL', internalType: 'string', type: 'string' },
              { name: 'metadata', internalType: 'string', type: 'string' },
              { name: 'context', internalType: 'string', type: 'string' },
            ],
          },
          {
            name: 'poolConfig',
            internalType: 'struct IUniverseManager.PoolConfig',
            type: 'tuple',
            components: [
              { name: 'hook', internalType: 'address', type: 'address' },
              { name: 'pairedToken', internalType: 'address', type: 'address' },
              {
                name: 'tickIfToken0IsLoar',
                internalType: 'int24',
                type: 'int24',
              },
              { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
              { name: 'poolData', internalType: 'bytes', type: 'bytes' },
            ],
          },
          {
            name: 'lockerConfig',
            internalType: 'struct IUniverseManager.LockerConfig',
            type: 'tuple',
            components: [
              { name: 'locker', internalType: 'address', type: 'address' },
              {
                name: 'rewardAdmins',
                internalType: 'address[]',
                type: 'address[]',
              },
              {
                name: 'rewardRecipients',
                internalType: 'address[]',
                type: 'address[]',
              },
              { name: 'rewardBps', internalType: 'uint16[]', type: 'uint16[]' },
              { name: 'tickLower', internalType: 'int24[]', type: 'int24[]' },
              { name: 'tickUpper', internalType: 'int24[]', type: 'int24[]' },
              {
                name: 'positionBps',
                internalType: 'uint16[]',
                type: 'uint16[]',
              },
              { name: 'lockerData', internalType: 'bytes', type: 'bytes' },
            ],
          },
          {
            name: 'allocationConfig',
            internalType: 'struct IUniverseManager.AllocationConfig',
            type: 'tuple',
            components: [
              { name: 'lpBps', internalType: 'uint16', type: 'uint16' },
              { name: 'creatorBps', internalType: 'uint16', type: 'uint16' },
              { name: 'treasuryBps', internalType: 'uint16', type: 'uint16' },
              { name: 'communityBps', internalType: 'uint16', type: 'uint16' },
            ],
          },
        ],
      },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'deployUniverseToken',
    outputs: [{ name: 'tokenAddress', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'deprecated',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'hook', internalType: 'address', type: 'address' }],
    name: 'enabledHooks',
    outputs: [{ name: 'enabled', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'locker', internalType: 'address', type: 'address' },
      { name: 'hook', internalType: 'address', type: 'address' },
    ],
    name: 'enabledLockers',
    outputs: [{ name: 'enabled', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'getUniverseData',
    outputs: [
      { name: 'universe', internalType: 'contract IUniverse', type: 'address' },
      { name: 'token', internalType: 'contract IERC20', type: 'address' },
      {
        name: 'universeGovernor',
        internalType: 'contract IGovernor',
        type: 'address',
      },
      { name: 'hook', internalType: 'contract IHooks', type: 'address' },
      {
        name: 'locker',
        internalType: 'contract ILoarLpLocker',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lpRecipient',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'deprecated_', internalType: 'bool', type: 'bool' }],
    name: 'setDeprecated',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'hook', internalType: 'address', type: 'address' },
      { name: 'enabled', internalType: 'bool', type: 'bool' },
    ],
    name: 'setHook',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'locker', internalType: 'address', type: 'address' },
      { name: 'hook', internalType: 'address', type: 'address' },
      { name: 'enabled', internalType: 'bool', type: 'bool' },
    ],
    name: 'setLocker',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_lpRecipient', internalType: 'address', type: 'address' }],
    name: 'setLpRecipient',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_teamFeeRecipient', internalType: 'address', type: 'address' }],
    name: 'setTeamFeeRecipient',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_tokenDeployer', internalType: 'address', type: 'address' }],
    name: 'setTokenDeployer',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'teamFee',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'teamFeeRecipient',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tokenDeployer',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalCreditFundsHeld',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'universeCreditFund',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'recipient',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ClaimTeamFees',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'previousOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'deprecated',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'SetDeprecated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'hook',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      { name: 'enabled', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'SetHook',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'locker',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'hook',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      { name: 'enabled', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'SetLocker',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldLpRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newLpRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'SetLpRecipient',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTeamFeeRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newTeamFeeRecipient',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'SetTeamFeeRecipient',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTokenDeployer',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'newTokenDeployer',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'SetTokenDeployer',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'msgSender',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'tokenAddress',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenAdmin',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'tokenImage',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'tokenName',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'tokenSymbol',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'tokenMetadata',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'tokenContext',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'startingTick',
        internalType: 'int24',
        type: 'int24',
        indexed: false,
      },
      {
        name: 'poolHook',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'poolId',
        internalType: 'PoolId',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'pairedToken',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'locker',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'governor',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'TokenCreated',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'TokenDeployed' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universe',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'UniverseCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'lpAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'creditAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'UniverseMintFee',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'AddressInsufficientBalance',
  },
  { type: 'error', inputs: [], name: 'CallerIsNotOwner' },
  { type: 'error', inputs: [], name: 'DeployerIsNotOwner' },
  { type: 'error', inputs: [], name: 'Deprecated' },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'HookNotEnabled' },
  { type: 'error', inputs: [], name: 'InsufficientMintFee' },
  { type: 'error', inputs: [], name: 'InvalidHook' },
  { type: 'error', inputs: [], name: 'InvalidLocker' },
  { type: 'error', inputs: [], name: 'LockerNotEnabled' },
  { type: 'error', inputs: [], name: 'LpRecipientNotSet' },
  {
    type: 'error',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'OwnableInvalidOwner',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'OwnableUnauthorizedAccount',
  },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
  { type: 'error', inputs: [], name: 'TeamFeeRecipientNotSet' },
  { type: 'error', inputs: [], name: 'TokenAlreadyDeployed' },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// UniverseTokenDeployer
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const universeTokenDeployerAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_universeManager', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_COMMUNITY_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_CREATOR_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_LP_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'DEFAULT_TREASURY_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_CREATOR_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MIN_LP_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'MIN_TREASURY_BPS',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'TOKEN_SUPPLY',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'deploymentConfig',
        internalType: 'struct IUniverseManager.DeploymentConfig',
        type: 'tuple',
        components: [
          {
            name: 'tokenConfig',
            internalType: 'struct IUniverseManager.TokenConfig',
            type: 'tuple',
            components: [
              { name: 'tokenAdmin', internalType: 'address', type: 'address' },
              { name: 'name', internalType: 'string', type: 'string' },
              { name: 'symbol', internalType: 'string', type: 'string' },
              { name: 'imageURL', internalType: 'string', type: 'string' },
              { name: 'metadata', internalType: 'string', type: 'string' },
              { name: 'context', internalType: 'string', type: 'string' },
            ],
          },
          {
            name: 'poolConfig',
            internalType: 'struct IUniverseManager.PoolConfig',
            type: 'tuple',
            components: [
              { name: 'hook', internalType: 'address', type: 'address' },
              { name: 'pairedToken', internalType: 'address', type: 'address' },
              {
                name: 'tickIfToken0IsLoar',
                internalType: 'int24',
                type: 'int24',
              },
              { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
              { name: 'poolData', internalType: 'bytes', type: 'bytes' },
            ],
          },
          {
            name: 'lockerConfig',
            internalType: 'struct IUniverseManager.LockerConfig',
            type: 'tuple',
            components: [
              { name: 'locker', internalType: 'address', type: 'address' },
              {
                name: 'rewardAdmins',
                internalType: 'address[]',
                type: 'address[]',
              },
              {
                name: 'rewardRecipients',
                internalType: 'address[]',
                type: 'address[]',
              },
              { name: 'rewardBps', internalType: 'uint16[]', type: 'uint16[]' },
              { name: 'tickLower', internalType: 'int24[]', type: 'int24[]' },
              { name: 'tickUpper', internalType: 'int24[]', type: 'int24[]' },
              {
                name: 'positionBps',
                internalType: 'uint16[]',
                type: 'uint16[]',
              },
              { name: 'lockerData', internalType: 'bytes', type: 'bytes' },
            ],
          },
          {
            name: 'allocationConfig',
            internalType: 'struct IUniverseManager.AllocationConfig',
            type: 'tuple',
            components: [
              { name: 'lpBps', internalType: 'uint16', type: 'uint16' },
              { name: 'creatorBps', internalType: 'uint16', type: 'uint16' },
              { name: 'treasuryBps', internalType: 'uint16', type: 'uint16' },
              { name: 'communityBps', internalType: 'uint16', type: 'uint16' },
            ],
          },
        ],
      },
      { name: 'universeId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'deployTokenAndGovernance',
    outputs: [
      { name: 'tokenAddress', internalType: 'address', type: 'address' },
      { name: 'governor', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'universeManager',
    outputs: [{ name: '', internalType: 'contract IUniverseManager', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'lpAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'creatorAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'treasuryAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'communityAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TokenAllocation',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'universeId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'tokenAddress',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'hook', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'locker',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'TokenDeployed',
  },
  {
    type: 'error',
    inputs: [{ name: 'target', internalType: 'address', type: 'address' }],
    name: 'AddressEmptyCode',
  },
  {
    type: 'error',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'AddressInsufficientBalance',
  },
  { type: 'error', inputs: [], name: 'FailedInnerCall' },
  { type: 'error', inputs: [], name: 'HookNotEnabled' },
  { type: 'error', inputs: [], name: 'InvalidAllocation' },
  { type: 'error', inputs: [], name: 'LockerNotEnabled' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  {
    type: 'error',
    inputs: [{ name: 'token', internalType: 'address', type: 'address' }],
    name: 'SafeERC20FailedOperation',
  },
] as const;

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// React
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__
 */
export const useCharacterNft_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"MAX_FEE_BPS"`
 */
export const useCharacterNft_MaxFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'MAX_FEE_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"appearanceFeeBps"`
 */
export const useCharacterNft_AppearanceFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'appearanceFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useCharacterNft_BalanceOf_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'balanceOf',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"characterByName"`
 */
export const useCharacterNft_CharacterByName_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'characterByName',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"characters"`
 */
export const useCharacterNft_Characters_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'characters',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"getApproved"`
 */
export const useCharacterNft_GetApproved_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'getApproved',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"getCharactersByUniverse"`
 */
export const useCharacterNft_GetCharactersByUniverse_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'getCharactersByUniverse',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useCharacterNft_IsApprovedForAll_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'isApprovedForAll',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"name"`
 */
export const useCharacterNft_Name_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'name',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"nextCharacterId"`
 */
export const useCharacterNft_NextCharacterId_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'nextCharacterId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"ownerOf"`
 */
export const useCharacterNft_OwnerOf_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'ownerOf',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"paymentRouter"`
 */
export const useCharacterNft_PaymentRouter_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'paymentRouter',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"platform"`
 */
export const useCharacterNft_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"rightsRegistry"`
 */
export const useCharacterNft_RightsRegistry_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'rightsRegistry',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"royaltyInfo"`
 */
export const useCharacterNft_RoyaltyInfo_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'royaltyInfo',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useCharacterNft_SupportsInterface_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'supportsInterface',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"symbol"`
 */
export const useCharacterNft_Symbol_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'symbol',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"tokenByIndex"`
 */
export const useCharacterNft_TokenByIndex_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'tokenByIndex',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"tokenOfOwnerByIndex"`
 */
export const useCharacterNft_TokenOfOwnerByIndex_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'tokenOfOwnerByIndex',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"tokenURI"`
 */
export const useCharacterNft_TokenUri_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'tokenURI',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"totalSupply"`
 */
export const useCharacterNft_TotalSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'totalSupply',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"universeId"`
 */
export const useCharacterNft_UniverseId_read = /*#__PURE__*/ createUseReadContract({
  abi: characterNftAbi,
  functionName: 'universeId',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__
 */
export const useCharacterNft_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"approve"`
 */
export const useCharacterNft_Approve_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"createCharacter"`
 */
export const useCharacterNft_CreateCharacter_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'createCharacter',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"initialize"`
 */
export const useCharacterNft_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"recordAppearance"`
 */
export const useCharacterNft_RecordAppearance_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'recordAppearance',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useCharacterNft_SafeTransferFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'safeTransferFrom',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useCharacterNft_SetApprovalForAll_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'setApprovalForAll',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useCharacterNft_TransferFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: characterNftAbi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__
 */
export const useCharacterNft_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"approve"`
 */
export const useCharacterNft_Approve_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"createCharacter"`
 */
export const useCharacterNft_CreateCharacter_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'createCharacter',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"initialize"`
 */
export const useCharacterNft_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"recordAppearance"`
 */
export const useCharacterNft_RecordAppearance_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'recordAppearance',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useCharacterNft_SafeTransferFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'safeTransferFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useCharacterNft_SetApprovalForAll_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'setApprovalForAll',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link characterNftAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useCharacterNft_TransferFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: characterNftAbi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__
 */
export const useCharacterNft_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"Approval"`
 */
export const useCharacterNft_Approval_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'Approval',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useCharacterNft_ApprovalForAll_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'ApprovalForAll',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"BatchMetadataUpdate"`
 */
export const useCharacterNft_BatchMetadataUpdate_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'BatchMetadataUpdate',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"CharacterAppearance"`
 */
export const useCharacterNft_CharacterAppearance_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'CharacterAppearance',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"CharacterCreated"`
 */
export const useCharacterNft_CharacterCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'CharacterCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"Initialized"`
 */
export const useCharacterNft_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"MetadataUpdate"`
 */
export const useCharacterNft_MetadataUpdate_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'MetadataUpdate',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"RoyaltyClaimed"`
 */
export const useCharacterNft_RoyaltyClaimed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'RoyaltyClaimed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link characterNftAbi}__ and `eventName` set to `"Transfer"`
 */
export const useCharacterNft_Transfer_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: characterNftAbi,
  eventName: 'Transfer',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__
 */
export const useCreditManager_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"FIAT_MARGIN_BPS"`
 */
export const useCreditManager_FiatMarginBps_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'FIAT_MARGIN_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"LOAR_MARGIN_BPS"`
 */
export const useCreditManager_LoarMarginBps_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'LOAR_MARGIN_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const useCreditManager_UpgradeInterfaceVersion_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'UPGRADE_INTERFACE_VERSION',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"generationCosts"`
 */
export const useCreditManager_GenerationCosts_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'generationCosts',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"getBalance"`
 */
export const useCreditManager_GetBalance_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'getBalance',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"getGenerationCost"`
 */
export const useCreditManager_GetGenerationCost_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'getGenerationCost',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"getUserStats"`
 */
export const useCreditManager_GetUserStats_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'getUserStats',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"holderDiscountBps"`
 */
export const useCreditManager_HolderDiscountBps_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'holderDiscountBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"loarToken"`
 */
export const useCreditManager_LoarToken_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'loarToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"nextPackageId"`
 */
export const useCreditManager_NextPackageId_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'nextPackageId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"owner"`
 */
export const useCreditManager_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"packages"`
 */
export const useCreditManager_Packages_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'packages',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"paymentRouter"`
 */
export const useCreditManager_PaymentRouter_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'paymentRouter',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"platform"`
 */
export const useCreditManager_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useCreditManager_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"treasury"`
 */
export const useCreditManager_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"userCredits"`
 */
export const useCreditManager_UserCredits_read = /*#__PURE__*/ createUseReadContract({
  abi: creditManagerAbi,
  functionName: 'userCredits',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__
 */
export const useCreditManager_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"createPackage"`
 */
export const useCreditManager_CreatePackage_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'createPackage',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"deactivatePackage"`
 */
export const useCreditManager_DeactivatePackage_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'deactivatePackage',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"grantCredits"`
 */
export const useCreditManager_GrantCredits_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'grantCredits',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useCreditManager_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"purchaseWithEth"`
 */
export const useCreditManager_PurchaseWithEth_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'purchaseWithEth',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"purchaseWithLoar"`
 */
export const useCreditManager_PurchaseWithLoar_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'purchaseWithLoar',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useCreditManager_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"setGenerationCost"`
 */
export const useCreditManager_SetGenerationCost_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'setGenerationCost',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"setHolderDiscount"`
 */
export const useCreditManager_SetHolderDiscount_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'setHolderDiscount',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"spendCredits"`
 */
export const useCreditManager_SpendCredits_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'spendCredits',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useCreditManager_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"updateLoarToken"`
 */
export const useCreditManager_UpdateLoarToken_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'updateLoarToken',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useCreditManager_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: creditManagerAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__
 */
export const useCreditManager_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"createPackage"`
 */
export const useCreditManager_CreatePackage_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'createPackage',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"deactivatePackage"`
 */
export const useCreditManager_DeactivatePackage_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'deactivatePackage',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"grantCredits"`
 */
export const useCreditManager_GrantCredits_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'grantCredits',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useCreditManager_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"purchaseWithEth"`
 */
export const useCreditManager_PurchaseWithEth_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'purchaseWithEth',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"purchaseWithLoar"`
 */
export const useCreditManager_PurchaseWithLoar_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'purchaseWithLoar',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useCreditManager_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"setGenerationCost"`
 */
export const useCreditManager_SetGenerationCost_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'setGenerationCost',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"setHolderDiscount"`
 */
export const useCreditManager_SetHolderDiscount_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'setHolderDiscount',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"spendCredits"`
 */
export const useCreditManager_SpendCredits_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'spendCredits',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useCreditManager_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"updateLoarToken"`
 */
export const useCreditManager_UpdateLoarToken_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'updateLoarToken',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link creditManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useCreditManager_UpgradeToAndCall_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: creditManagerAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__
 */
export const useCreditManager_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: creditManagerAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"CreditsGranted"`
 */
export const useCreditManager_CreditsGranted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: creditManagerAbi,
  eventName: 'CreditsGranted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"CreditsPurchasedWithEth"`
 */
export const useCreditManager_CreditsPurchasedWithEth_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: creditManagerAbi,
    eventName: 'CreditsPurchasedWithEth',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"CreditsPurchasedWithLoar"`
 */
export const useCreditManager_CreditsPurchasedWithLoar_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: creditManagerAbi,
    eventName: 'CreditsPurchasedWithLoar',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"CreditsSpent"`
 */
export const useCreditManager_CreditsSpent_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: creditManagerAbi,
  eventName: 'CreditsSpent',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"GenerationCostUpdated"`
 */
export const useCreditManager_GenerationCostUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: creditManagerAbi,
    eventName: 'GenerationCostUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"Initialized"`
 */
export const useCreditManager_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: creditManagerAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useCreditManager_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: creditManagerAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"PackageCreated"`
 */
export const useCreditManager_PackageCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: creditManagerAbi,
  eventName: 'PackageCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link creditManagerAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useCreditManager_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: creditManagerAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__
 */
export const useEpisodeNft_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"MAX_FEE_BPS"`
 */
export const useEpisodeNft_MaxFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'MAX_FEE_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useEpisodeNft_BalanceOf_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'balanceOf',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"defaultRoyaltyBps"`
 */
export const useEpisodeNft_DefaultRoyaltyBps_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'defaultRoyaltyBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"episodes"`
 */
export const useEpisodeNft_Episodes_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'episodes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"getApproved"`
 */
export const useEpisodeNft_GetApproved_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'getApproved',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useEpisodeNft_IsApprovedForAll_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'isApprovedForAll',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"name"`
 */
export const useEpisodeNft_Name_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'name',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"nextEpisodeId"`
 */
export const useEpisodeNft_NextEpisodeId_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'nextEpisodeId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"nextTokenId"`
 */
export const useEpisodeNft_NextTokenId_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'nextTokenId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"ownerOf"`
 */
export const useEpisodeNft_OwnerOf_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'ownerOf',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"paymentRouter"`
 */
export const useEpisodeNft_PaymentRouter_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'paymentRouter',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"platform"`
 */
export const useEpisodeNft_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"platformFeeBps"`
 */
export const useEpisodeNft_PlatformFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'platformFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"recognizedTokens"`
 */
export const useEpisodeNft_RecognizedTokens_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'recognizedTokens',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"rightsRegistry"`
 */
export const useEpisodeNft_RightsRegistry_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'rightsRegistry',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"royaltyInfo"`
 */
export const useEpisodeNft_RoyaltyInfo_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'royaltyInfo',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useEpisodeNft_SupportsInterface_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'supportsInterface',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"symbol"`
 */
export const useEpisodeNft_Symbol_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'symbol',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"tokenByIndex"`
 */
export const useEpisodeNft_TokenByIndex_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'tokenByIndex',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"tokenEpisode"`
 */
export const useEpisodeNft_TokenEpisode_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'tokenEpisode',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"tokenOfOwnerByIndex"`
 */
export const useEpisodeNft_TokenOfOwnerByIndex_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'tokenOfOwnerByIndex',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"tokenURI"`
 */
export const useEpisodeNft_TokenUri_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'tokenURI',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"totalSupply"`
 */
export const useEpisodeNft_TotalSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: episodeNftAbi,
  functionName: 'totalSupply',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__
 */
export const useEpisodeNft_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"approve"`
 */
export const useEpisodeNft_Approve_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"createEpisode"`
 */
export const useEpisodeNft_CreateEpisode_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'createEpisode',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"deactivateEpisode"`
 */
export const useEpisodeNft_DeactivateEpisode_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'deactivateEpisode',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"initialize"`
 */
export const useEpisodeNft_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"mint"`
 */
export const useEpisodeNft_Mint_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'mint',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useEpisodeNft_SafeTransferFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'safeTransferFrom',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useEpisodeNft_SetApprovalForAll_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'setApprovalForAll',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"setPlatformFee"`
 */
export const useEpisodeNft_SetPlatformFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'setPlatformFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useEpisodeNft_TransferFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: episodeNftAbi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__
 */
export const useEpisodeNft_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"approve"`
 */
export const useEpisodeNft_Approve_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"createEpisode"`
 */
export const useEpisodeNft_CreateEpisode_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'createEpisode',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"deactivateEpisode"`
 */
export const useEpisodeNft_DeactivateEpisode_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'deactivateEpisode',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"initialize"`
 */
export const useEpisodeNft_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"mint"`
 */
export const useEpisodeNft_Mint_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'mint',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useEpisodeNft_SafeTransferFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'safeTransferFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useEpisodeNft_SetApprovalForAll_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'setApprovalForAll',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"setPlatformFee"`
 */
export const useEpisodeNft_SetPlatformFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'setPlatformFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link episodeNftAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useEpisodeNft_TransferFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: episodeNftAbi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__
 */
export const useEpisodeNft_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"Approval"`
 */
export const useEpisodeNft_Approval_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'Approval',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useEpisodeNft_ApprovalForAll_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'ApprovalForAll',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"BatchMetadataUpdate"`
 */
export const useEpisodeNft_BatchMetadataUpdate_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'BatchMetadataUpdate',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"EpisodeCreated"`
 */
export const useEpisodeNft_EpisodeCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'EpisodeCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"EpisodeDeactivated"`
 */
export const useEpisodeNft_EpisodeDeactivated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'EpisodeDeactivated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"EpisodeMinted"`
 */
export const useEpisodeNft_EpisodeMinted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'EpisodeMinted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"Initialized"`
 */
export const useEpisodeNft_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"MetadataUpdate"`
 */
export const useEpisodeNft_MetadataUpdate_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'MetadataUpdate',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link episodeNftAbi}__ and `eventName` set to `"Transfer"`
 */
export const useEpisodeNft_Transfer_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: episodeNftAbi,
  eventName: 'Transfer',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__
 */
export const useGovernanceErc20_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"CLOCK_MODE"`
 */
export const useGovernanceErc20_ClockMode_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'CLOCK_MODE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"DOMAIN_SEPARATOR"`
 */
export const useGovernanceErc20_DomainSeparator_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'DOMAIN_SEPARATOR',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"admin"`
 */
export const useGovernanceErc20_Admin_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'admin',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"allowance"`
 */
export const useGovernanceErc20_Allowance_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'allowance',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"balanceOf"`
 */
export const useGovernanceErc20_BalanceOf_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'balanceOf',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"checkpoints"`
 */
export const useGovernanceErc20_Checkpoints_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'checkpoints',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"clock"`
 */
export const useGovernanceErc20_Clock_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'clock',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"context"`
 */
export const useGovernanceErc20_Context_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'context',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"decimals"`
 */
export const useGovernanceErc20_Decimals_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'decimals',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"delegates"`
 */
export const useGovernanceErc20_Delegates_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'delegates',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"eip712Domain"`
 */
export const useGovernanceErc20_Eip712Domain_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'eip712Domain',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"getPastTotalSupply"`
 */
export const useGovernanceErc20_GetPastTotalSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'getPastTotalSupply',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"getPastVotes"`
 */
export const useGovernanceErc20_GetPastVotes_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'getPastVotes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"getVotes"`
 */
export const useGovernanceErc20_GetVotes_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'getVotes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"imageUrl"`
 */
export const useGovernanceErc20_ImageUrl_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'imageUrl',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"metadata"`
 */
export const useGovernanceErc20_Metadata_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'metadata',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"name"`
 */
export const useGovernanceErc20_Name_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'name',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"nonces"`
 */
export const useGovernanceErc20_Nonces_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'nonces',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"numCheckpoints"`
 */
export const useGovernanceErc20_NumCheckpoints_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'numCheckpoints',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"symbol"`
 */
export const useGovernanceErc20_Symbol_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'symbol',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"totalSupply"`
 */
export const useGovernanceErc20_TotalSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'totalSupply',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"universe"`
 */
export const useGovernanceErc20_Universe_read = /*#__PURE__*/ createUseReadContract({
  abi: governanceErc20Abi,
  functionName: 'universe',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__
 */
export const useGovernanceErc20_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"approve"`
 */
export const useGovernanceErc20_Approve_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"delegate"`
 */
export const useGovernanceErc20_Delegate_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
  functionName: 'delegate',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"delegateBySig"`
 */
export const useGovernanceErc20_DelegateBySig_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
  functionName: 'delegateBySig',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"permit"`
 */
export const useGovernanceErc20_Permit_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
  functionName: 'permit',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"transfer"`
 */
export const useGovernanceErc20_Transfer_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
  functionName: 'transfer',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"transferFrom"`
 */
export const useGovernanceErc20_TransferFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: governanceErc20Abi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__
 */
export const useGovernanceErc20_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"approve"`
 */
export const useGovernanceErc20_Approve_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"delegate"`
 */
export const useGovernanceErc20_Delegate_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
  functionName: 'delegate',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"delegateBySig"`
 */
export const useGovernanceErc20_DelegateBySig_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
  functionName: 'delegateBySig',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"permit"`
 */
export const useGovernanceErc20_Permit_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
  functionName: 'permit',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"transfer"`
 */
export const useGovernanceErc20_Transfer_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
  functionName: 'transfer',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link governanceErc20Abi}__ and `functionName` set to `"transferFrom"`
 */
export const useGovernanceErc20_TransferFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: governanceErc20Abi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link governanceErc20Abi}__
 */
export const useGovernanceErc20_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: governanceErc20Abi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link governanceErc20Abi}__ and `eventName` set to `"Approval"`
 */
export const useGovernanceErc20_Approval_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: governanceErc20Abi,
  eventName: 'Approval',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link governanceErc20Abi}__ and `eventName` set to `"DelegateChanged"`
 */
export const useGovernanceErc20_DelegateChanged_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: governanceErc20Abi,
  eventName: 'DelegateChanged',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link governanceErc20Abi}__ and `eventName` set to `"DelegateVotesChanged"`
 */
export const useGovernanceErc20_DelegateVotesChanged_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: governanceErc20Abi,
    eventName: 'DelegateVotesChanged',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link governanceErc20Abi}__ and `eventName` set to `"EIP712DomainChanged"`
 */
export const useGovernanceErc20_Eip712DomainChanged_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: governanceErc20Abi,
    eventName: 'EIP712DomainChanged',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link governanceErc20Abi}__ and `eventName` set to `"Transfer"`
 */
export const useGovernanceErc20_Transfer_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: governanceErc20Abi,
  eventName: 'Transfer',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__
 */
export const useLaunchpadStaking_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const useLaunchpadStaking_UpgradeInterfaceVersion_read = /*#__PURE__*/ createUseReadContract(
  {
    abi: launchpadStakingAbi,
    functionName: 'UPGRADE_INTERFACE_VERSION',
  }
);

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"earlyUnstakePenaltyBps"`
 */
export const useLaunchpadStaking_EarlyUnstakePenaltyBps_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'earlyUnstakePenaltyBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"getAllocationWeight"`
 */
export const useLaunchpadStaking_GetAllocationWeight_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'getAllocationWeight',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"getCurationBoost"`
 */
export const useLaunchpadStaking_GetCurationBoost_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'getCurationBoost',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"getFeeDiscount"`
 */
export const useLaunchpadStaking_GetFeeDiscount_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'getFeeDiscount',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"getUserTier"`
 */
export const useLaunchpadStaking_GetUserTier_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'getUserTier',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"hasPriorityAccess"`
 */
export const useLaunchpadStaking_HasPriorityAccess_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'hasPriorityAccess',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"liquidityPool"`
 */
export const useLaunchpadStaking_LiquidityPool_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'liquidityPool',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"loarToken"`
 */
export const useLaunchpadStaking_LoarToken_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'loarToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"minLockPeriod"`
 */
export const useLaunchpadStaking_MinLockPeriod_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'minLockPeriod',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"owner"`
 */
export const useLaunchpadStaking_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"pendingUniverseReward"`
 */
export const useLaunchpadStaking_PendingUniverseReward_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'pendingUniverseReward',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useLaunchpadStaking_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"stakes"`
 */
export const useLaunchpadStaking_Stakes_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'stakes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"tierConfigs"`
 */
export const useLaunchpadStaking_TierConfigs_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'tierConfigs',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"tierCount"`
 */
export const useLaunchpadStaking_TierCount_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'tierCount',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"totalPenaltyCollected"`
 */
export const useLaunchpadStaking_TotalPenaltyCollected_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'totalPenaltyCollected',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"totalStaked"`
 */
export const useLaunchpadStaking_TotalStaked_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'totalStaked',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"totalUniverseStaked"`
 */
export const useLaunchpadStaking_TotalUniverseStaked_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'totalUniverseStaked',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"treasury"`
 */
export const useLaunchpadStaking_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"universePools"`
 */
export const useLaunchpadStaking_UniversePools_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'universePools',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"universeStakes"`
 */
export const useLaunchpadStaking_UniverseStakes_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'universeStakes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"wouldIncurPenalty"`
 */
export const useLaunchpadStaking_WouldIncurPenalty_read = /*#__PURE__*/ createUseReadContract({
  abi: launchpadStakingAbi,
  functionName: 'wouldIncurPenalty',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__
 */
export const useLaunchpadStaking_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"claimUniverseReward"`
 */
export const useLaunchpadStaking_ClaimUniverseReward_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'claimUniverseReward',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"distributeUniverseReward"`
 */
export const useLaunchpadStaking_DistributeUniverseReward_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: launchpadStakingAbi,
    functionName: 'distributeUniverseReward',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"initialize"`
 */
export const useLaunchpadStaking_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLaunchpadStaking_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setEarlyUnstakePenalty"`
 */
export const useLaunchpadStaking_SetEarlyUnstakePenalty_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: launchpadStakingAbi,
    functionName: 'setEarlyUnstakePenalty',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useLaunchpadStaking_SetLiquidityPool_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setMinLockPeriod"`
 */
export const useLaunchpadStaking_SetMinLockPeriod_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'setMinLockPeriod',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setTierConfig"`
 */
export const useLaunchpadStaking_SetTierConfig_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'setTierConfig',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useLaunchpadStaking_SetTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"stake"`
 */
export const useLaunchpadStaking_Stake_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'stake',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"stakeInUniverse"`
 */
export const useLaunchpadStaking_StakeInUniverse_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'stakeInUniverse',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLaunchpadStaking_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"unstake"`
 */
export const useLaunchpadStaking_Unstake_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'unstake',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"unstakeFromUniverse"`
 */
export const useLaunchpadStaking_UnstakeFromUniverse_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'unstakeFromUniverse',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useLaunchpadStaking_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: launchpadStakingAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__
 */
export const useLaunchpadStaking_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: launchpadStakingAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"claimUniverseReward"`
 */
export const useLaunchpadStaking_ClaimUniverseReward_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'claimUniverseReward',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"distributeUniverseReward"`
 */
export const useLaunchpadStaking_DistributeUniverseReward_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'distributeUniverseReward',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"initialize"`
 */
export const useLaunchpadStaking_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: launchpadStakingAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLaunchpadStaking_RenounceOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'renounceOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setEarlyUnstakePenalty"`
 */
export const useLaunchpadStaking_SetEarlyUnstakePenalty_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'setEarlyUnstakePenalty',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useLaunchpadStaking_SetLiquidityPool_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'setLiquidityPool',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setMinLockPeriod"`
 */
export const useLaunchpadStaking_SetMinLockPeriod_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'setMinLockPeriod',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setTierConfig"`
 */
export const useLaunchpadStaking_SetTierConfig_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: launchpadStakingAbi,
  functionName: 'setTierConfig',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useLaunchpadStaking_SetTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: launchpadStakingAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"stake"`
 */
export const useLaunchpadStaking_Stake_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: launchpadStakingAbi,
  functionName: 'stake',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"stakeInUniverse"`
 */
export const useLaunchpadStaking_StakeInUniverse_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: launchpadStakingAbi,
    functionName: 'stakeInUniverse',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLaunchpadStaking_TransferOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'transferOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"unstake"`
 */
export const useLaunchpadStaking_Unstake_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: launchpadStakingAbi,
  functionName: 'unstake',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"unstakeFromUniverse"`
 */
export const useLaunchpadStaking_UnstakeFromUniverse_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'unstakeFromUniverse',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link launchpadStakingAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useLaunchpadStaking_UpgradeToAndCall_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: launchpadStakingAbi,
    functionName: 'upgradeToAndCall',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__
 */
export const useLaunchpadStaking_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"Initialized"`
 */
export const useLaunchpadStaking_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useLaunchpadStaking_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: launchpadStakingAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"Staked"`
 */
export const useLaunchpadStaking_Staked_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
  eventName: 'Staked',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"TierChanged"`
 */
export const useLaunchpadStaking_TierChanged_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
  eventName: 'TierChanged',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"UniverseRewardClaimed"`
 */
export const useLaunchpadStaking_UniverseRewardClaimed_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: launchpadStakingAbi,
    eventName: 'UniverseRewardClaimed',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"UniverseRewardDistributed"`
 */
export const useLaunchpadStaking_UniverseRewardDistributed_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: launchpadStakingAbi,
    eventName: 'UniverseRewardDistributed',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"UniverseStaked"`
 */
export const useLaunchpadStaking_UniverseStaked_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
  eventName: 'UniverseStaked',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"UniverseUnstaked"`
 */
export const useLaunchpadStaking_UniverseUnstaked_watch = /*#__PURE__*/ createUseWatchContractEvent(
  {
    abi: launchpadStakingAbi,
    eventName: 'UniverseUnstaked',
  }
);

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"Unstaked"`
 */
export const useLaunchpadStaking_Unstaked_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
  eventName: 'Unstaked',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link launchpadStakingAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useLaunchpadStaking_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: launchpadStakingAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__
 */
export const useLoarBurner_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const useLoarBurner_UpgradeInterfaceVersion_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'UPGRADE_INTERFACE_VERSION',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"actions"`
 */
export const useLoarBurner_Actions_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'actions',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"customActions"`
 */
export const useLoarBurner_CustomActions_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'customActions',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"liquidityPool"`
 */
export const useLoarBurner_LiquidityPool_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'liquidityPool',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"loarToken"`
 */
export const useLoarBurner_LoarToken_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'loarToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"lpRatioBps"`
 */
export const useLoarBurner_LpRatioBps_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'lpRatioBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"owner"`
 */
export const useLoarBurner_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"platform"`
 */
export const useLoarBurner_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useLoarBurner_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"totalCollected"`
 */
export const useLoarBurner_TotalCollected_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'totalCollected',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"totalToLp"`
 */
export const useLoarBurner_TotalToLp_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'totalToLp',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"treasury"`
 */
export const useLoarBurner_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: loarBurnerAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__
 */
export const useLoarBurner_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"execute"`
 */
export const useLoarBurner_Execute_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'execute',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"executeCustom"`
 */
export const useLoarBurner_ExecuteCustom_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'executeCustom',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"executeFor"`
 */
export const useLoarBurner_ExecuteFor_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'executeFor',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"initialize"`
 */
export const useLoarBurner_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarBurner_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setActionConfig"`
 */
export const useLoarBurner_SetActionConfig_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'setActionConfig',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setCustomAction"`
 */
export const useLoarBurner_SetCustomAction_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'setCustomAction',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useLoarBurner_SetLiquidityPool_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setLpRatio"`
 */
export const useLoarBurner_SetLpRatio_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'setLpRatio',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setPlatform"`
 */
export const useLoarBurner_SetPlatform_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'setPlatform',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useLoarBurner_SetTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarBurner_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useLoarBurner_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarBurnerAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__
 */
export const useLoarBurner_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"execute"`
 */
export const useLoarBurner_Execute_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'execute',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"executeCustom"`
 */
export const useLoarBurner_ExecuteCustom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'executeCustom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"executeFor"`
 */
export const useLoarBurner_ExecuteFor_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'executeFor',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"initialize"`
 */
export const useLoarBurner_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarBurner_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setActionConfig"`
 */
export const useLoarBurner_SetActionConfig_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'setActionConfig',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setCustomAction"`
 */
export const useLoarBurner_SetCustomAction_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'setCustomAction',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useLoarBurner_SetLiquidityPool_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setLpRatio"`
 */
export const useLoarBurner_SetLpRatio_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'setLpRatio',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setPlatform"`
 */
export const useLoarBurner_SetPlatform_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'setPlatform',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useLoarBurner_SetTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarBurner_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarBurnerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useLoarBurner_UpgradeToAndCall_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarBurnerAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__
 */
export const useLoarBurner_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"ActionConfigUpdated"`
 */
export const useLoarBurner_ActionConfigUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'ActionConfigUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"ActionExecuted"`
 */
export const useLoarBurner_ActionExecuted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'ActionExecuted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"CustomActionConfigUpdated"`
 */
export const useLoarBurner_CustomActionConfigUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarBurnerAbi,
    eventName: 'CustomActionConfigUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"CustomActionExecuted"`
 */
export const useLoarBurner_CustomActionExecuted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'CustomActionExecuted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"Initialized"`
 */
export const useLoarBurner_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"LpRatioUpdated"`
 */
export const useLoarBurner_LpRatioUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'LpRatioUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useLoarBurner_OwnershipTransferred_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'OwnershipTransferred',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarBurnerAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useLoarBurner_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarBurnerAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarFeeLockerAbi}__
 */
export const useLoarFeeLocker_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: loarFeeLockerAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"allowedDepositors"`
 */
export const useLoarFeeLocker_AllowedDepositors_read = /*#__PURE__*/ createUseReadContract({
  abi: loarFeeLockerAbi,
  functionName: 'allowedDepositors',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"availableFees"`
 */
export const useLoarFeeLocker_AvailableFees_read = /*#__PURE__*/ createUseReadContract({
  abi: loarFeeLockerAbi,
  functionName: 'availableFees',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"feesToClaim"`
 */
export const useLoarFeeLocker_FeesToClaim_read = /*#__PURE__*/ createUseReadContract({
  abi: loarFeeLockerAbi,
  functionName: 'feesToClaim',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"owner"`
 */
export const useLoarFeeLocker_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: loarFeeLockerAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useLoarFeeLocker_SupportsInterface_read = /*#__PURE__*/ createUseReadContract({
  abi: loarFeeLockerAbi,
  functionName: 'supportsInterface',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__
 */
export const useLoarFeeLocker_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"addDepositor"`
 */
export const useLoarFeeLocker_AddDepositor_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
  functionName: 'addDepositor',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"claim"`
 */
export const useLoarFeeLocker_Claim_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
  functionName: 'claim',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"removeDepositor"`
 */
export const useLoarFeeLocker_RemoveDepositor_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
  functionName: 'removeDepositor',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarFeeLocker_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"storeFees"`
 */
export const useLoarFeeLocker_StoreFees_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
  functionName: 'storeFees',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarFeeLocker_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarFeeLockerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__
 */
export const useLoarFeeLocker_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"addDepositor"`
 */
export const useLoarFeeLocker_AddDepositor_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
  functionName: 'addDepositor',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"claim"`
 */
export const useLoarFeeLocker_Claim_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
  functionName: 'claim',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"removeDepositor"`
 */
export const useLoarFeeLocker_RemoveDepositor_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
  functionName: 'removeDepositor',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarFeeLocker_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"storeFees"`
 */
export const useLoarFeeLocker_StoreFees_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
  functionName: 'storeFees',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarFeeLocker_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarFeeLockerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__
 */
export const useLoarFeeLocker_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarFeeLockerAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `eventName` set to `"AddDepositor"`
 */
export const useLoarFeeLocker_AddDepositor_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarFeeLockerAbi,
  eventName: 'AddDepositor',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `eventName` set to `"ClaimTokens"`
 */
export const useLoarFeeLocker_ClaimTokens_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarFeeLockerAbi,
  eventName: 'ClaimTokens',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `eventName` set to `"ClaimTokensPermissioned"`
 */
export const useLoarFeeLocker_ClaimTokensPermissioned_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarFeeLockerAbi,
    eventName: 'ClaimTokensPermissioned',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useLoarFeeLocker_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarFeeLockerAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `eventName` set to `"RemoveDepositor"`
 */
export const useLoarFeeLocker_RemoveDepositor_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarFeeLockerAbi,
  eventName: 'RemoveDepositor',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarFeeLockerAbi}__ and `eventName` set to `"StoreTokens"`
 */
export const useLoarFeeLocker_StoreTokens_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarFeeLockerAbi,
  eventName: 'StoreTokens',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__
 */
export const useLoarHookStaticFee_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"FEE_DENOMINATOR"`
 */
export const useLoarHookStaticFee_FeeDenominator_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'FEE_DENOMINATOR',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"MAX_LP_FEE"`
 */
export const useLoarHookStaticFee_MaxLpFee_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'MAX_LP_FEE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"PROTOCOL_FEE_NUMERATOR"`
 */
export const useLoarHookStaticFee_ProtocolFeeNumerator_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'PROTOCOL_FEE_NUMERATOR',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"factory"`
 */
export const useLoarHookStaticFee_Factory_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'factory',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"getHookPermissions"`
 */
export const useLoarHookStaticFee_GetHookPermissions_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'getHookPermissions',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"loarFee"`
 */
export const useLoarHookStaticFee_LoarFee_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'loarFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"owner"`
 */
export const useLoarHookStaticFee_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"pairedFee"`
 */
export const useLoarHookStaticFee_PairedFee_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'pairedFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"poolCreationTimestamp"`
 */
export const useLoarHookStaticFee_PoolCreationTimestamp_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'poolCreationTimestamp',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"poolManager"`
 */
export const useLoarHookStaticFee_PoolManager_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'poolManager',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"protocolFee"`
 */
export const useLoarHookStaticFee_ProtocolFee_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'protocolFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useLoarHookStaticFee_SupportsInterface_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'supportsInterface',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"weth"`
 */
export const useLoarHookStaticFee_Weth_read = /*#__PURE__*/ createUseReadContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'weth',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__
 */
export const useLoarHookStaticFee_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterAddLiquidity"`
 */
export const useLoarHookStaticFee_AfterAddLiquidity_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'afterAddLiquidity',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterDonate"`
 */
export const useLoarHookStaticFee_AfterDonate_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'afterDonate',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterInitialize"`
 */
export const useLoarHookStaticFee_AfterInitialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'afterInitialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterRemoveLiquidity"`
 */
export const useLoarHookStaticFee_AfterRemoveLiquidity_write = /*#__PURE__*/ createUseWriteContract(
  {
    abi: loarHookStaticFeeAbi,
    functionName: 'afterRemoveLiquidity',
  }
);

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterSwap"`
 */
export const useLoarHookStaticFee_AfterSwap_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'afterSwap',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeAddLiquidity"`
 */
export const useLoarHookStaticFee_BeforeAddLiquidity_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'beforeAddLiquidity',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeDonate"`
 */
export const useLoarHookStaticFee_BeforeDonate_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'beforeDonate',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeInitialize"`
 */
export const useLoarHookStaticFee_BeforeInitialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'beforeInitialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeRemoveLiquidity"`
 */
export const useLoarHookStaticFee_BeforeRemoveLiquidity_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'beforeRemoveLiquidity',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeSwap"`
 */
export const useLoarHookStaticFee_BeforeSwap_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'beforeSwap',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"initializePool"`
 */
export const useLoarHookStaticFee_InitializePool_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'initializePool',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarHookStaticFee_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarHookStaticFee_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__
 */
export const useLoarHookStaticFee_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarHookStaticFeeAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterAddLiquidity"`
 */
export const useLoarHookStaticFee_AfterAddLiquidity_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'afterAddLiquidity',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterDonate"`
 */
export const useLoarHookStaticFee_AfterDonate_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'afterDonate',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterInitialize"`
 */
export const useLoarHookStaticFee_AfterInitialize_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'afterInitialize',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterRemoveLiquidity"`
 */
export const useLoarHookStaticFee_AfterRemoveLiquidity_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'afterRemoveLiquidity',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"afterSwap"`
 */
export const useLoarHookStaticFee_AfterSwap_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'afterSwap',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeAddLiquidity"`
 */
export const useLoarHookStaticFee_BeforeAddLiquidity_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'beforeAddLiquidity',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeDonate"`
 */
export const useLoarHookStaticFee_BeforeDonate_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'beforeDonate',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeInitialize"`
 */
export const useLoarHookStaticFee_BeforeInitialize_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'beforeInitialize',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeRemoveLiquidity"`
 */
export const useLoarHookStaticFee_BeforeRemoveLiquidity_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'beforeRemoveLiquidity',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"beforeSwap"`
 */
export const useLoarHookStaticFee_BeforeSwap_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarHookStaticFeeAbi,
  functionName: 'beforeSwap',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"initializePool"`
 */
export const useLoarHookStaticFee_InitializePool_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: loarHookStaticFeeAbi,
    functionName: 'initializePool',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarHookStaticFee_RenounceOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'renounceOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarHookStaticFee_TransferOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarHookStaticFeeAbi,
    functionName: 'transferOwnership',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarHookStaticFeeAbi}__
 */
export const useLoarHookStaticFee_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarHookStaticFeeAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `eventName` set to `"ClaimProtocolFees"`
 */
export const useLoarHookStaticFee_ClaimProtocolFees_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarHookStaticFeeAbi,
    eventName: 'ClaimProtocolFees',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useLoarHookStaticFee_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarHookStaticFeeAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `eventName` set to `"PoolCreatedFactory"`
 */
export const useLoarHookStaticFee_PoolCreatedFactory_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarHookStaticFeeAbi,
    eventName: 'PoolCreatedFactory',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `eventName` set to `"PoolCreatedOpen"`
 */
export const useLoarHookStaticFee_PoolCreatedOpen_watch = /*#__PURE__*/ createUseWatchContractEvent(
  {
    abi: loarHookStaticFeeAbi,
    eventName: 'PoolCreatedOpen',
  }
);

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarHookStaticFeeAbi}__ and `eventName` set to `"PoolInitialized"`
 */
export const useLoarHookStaticFee_PoolInitialized_watch = /*#__PURE__*/ createUseWatchContractEvent(
  {
    abi: loarHookStaticFeeAbi,
    eventName: 'PoolInitialized',
  }
);

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__
 */
export const useLoarLpLockerMultiple_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"BASIS_POINTS"`
 */
export const useLoarLpLockerMultiple_BasisPoints_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'BASIS_POINTS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"MAX_LP_POSITIONS"`
 */
export const useLoarLpLockerMultiple_MaxLpPositions_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'MAX_LP_POSITIONS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"MAX_REWARD_PARTICIPANTS"`
 */
export const useLoarLpLockerMultiple_MaxRewardParticipants_read =
  /*#__PURE__*/ createUseReadContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'MAX_REWARD_PARTICIPANTS',
  });

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"factory"`
 */
export const useLoarLpLockerMultiple_Factory_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'factory',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"feeLocker"`
 */
export const useLoarLpLockerMultiple_FeeLocker_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'feeLocker',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"owner"`
 */
export const useLoarLpLockerMultiple_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"permit2"`
 */
export const useLoarLpLockerMultiple_Permit2_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'permit2',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"positionManager"`
 */
export const useLoarLpLockerMultiple_PositionManager_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'positionManager',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useLoarLpLockerMultiple_SupportsInterface_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'supportsInterface',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"tokenRewards"`
 */
export const useLoarLpLockerMultiple_TokenRewards_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'tokenRewards',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"version"`
 */
export const useLoarLpLockerMultiple_Version_read = /*#__PURE__*/ createUseReadContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'version',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__
 */
export const useLoarLpLockerMultiple_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarLpLockerMultipleAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"collectRewards"`
 */
export const useLoarLpLockerMultiple_CollectRewards_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'collectRewards',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"collectRewardsWithoutUnlock"`
 */
export const useLoarLpLockerMultiple_CollectRewardsWithoutUnlock_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'collectRewardsWithoutUnlock',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"onERC721Received"`
 */
export const useLoarLpLockerMultiple_OnErc721Received_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'onERC721Received',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"placeLiquidity"`
 */
export const useLoarLpLockerMultiple_PlaceLiquidity_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'placeLiquidity',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarLpLockerMultiple_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract(
  {
    abi: loarLpLockerMultipleAbi,
    functionName: 'renounceOwnership',
  }
);

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarLpLockerMultiple_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract(
  {
    abi: loarLpLockerMultipleAbi,
    functionName: 'transferOwnership',
  }
);

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"updateRewardAdmin"`
 */
export const useLoarLpLockerMultiple_UpdateRewardAdmin_write = /*#__PURE__*/ createUseWriteContract(
  {
    abi: loarLpLockerMultipleAbi,
    functionName: 'updateRewardAdmin',
  }
);

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"updateRewardRecipient"`
 */
export const useLoarLpLockerMultiple_UpdateRewardRecipient_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'updateRewardRecipient',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"withdrawERC20"`
 */
export const useLoarLpLockerMultiple_WithdrawErc20_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'withdrawERC20',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"withdrawETH"`
 */
export const useLoarLpLockerMultiple_WithdrawEth_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarLpLockerMultipleAbi,
  functionName: 'withdrawETH',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__
 */
export const useLoarLpLockerMultiple_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarLpLockerMultipleAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"collectRewards"`
 */
export const useLoarLpLockerMultiple_CollectRewards_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'collectRewards',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"collectRewardsWithoutUnlock"`
 */
export const useLoarLpLockerMultiple_CollectRewardsWithoutUnlock_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'collectRewardsWithoutUnlock',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"onERC721Received"`
 */
export const useLoarLpLockerMultiple_OnErc721Received_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'onERC721Received',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"placeLiquidity"`
 */
export const useLoarLpLockerMultiple_PlaceLiquidity_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'placeLiquidity',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarLpLockerMultiple_RenounceOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'renounceOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarLpLockerMultiple_TransferOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'transferOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"updateRewardAdmin"`
 */
export const useLoarLpLockerMultiple_UpdateRewardAdmin_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'updateRewardAdmin',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"updateRewardRecipient"`
 */
export const useLoarLpLockerMultiple_UpdateRewardRecipient_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'updateRewardRecipient',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"withdrawERC20"`
 */
export const useLoarLpLockerMultiple_WithdrawErc20_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: loarLpLockerMultipleAbi,
    functionName: 'withdrawERC20',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `functionName` set to `"withdrawETH"`
 */
export const useLoarLpLockerMultiple_WithdrawEth_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: loarLpLockerMultipleAbi,
    functionName: 'withdrawETH',
  }
);

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__
 */
export const useLoarLpLockerMultiple_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarLpLockerMultipleAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `eventName` set to `"ClaimedRewards"`
 */
export const useLoarLpLockerMultiple_ClaimedRewards_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarLpLockerMultipleAbi,
    eventName: 'ClaimedRewards',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useLoarLpLockerMultiple_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarLpLockerMultipleAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `eventName` set to `"Received"`
 */
export const useLoarLpLockerMultiple_Received_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarLpLockerMultipleAbi,
  eventName: 'Received',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `eventName` set to `"RewardAdminUpdated"`
 */
export const useLoarLpLockerMultiple_RewardAdminUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarLpLockerMultipleAbi,
    eventName: 'RewardAdminUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `eventName` set to `"RewardRecipientUpdated"`
 */
export const useLoarLpLockerMultiple_RewardRecipientUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarLpLockerMultipleAbi,
    eventName: 'RewardRecipientUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarLpLockerMultipleAbi}__ and `eventName` set to `"TokenRewardAdded"`
 */
export const useLoarLpLockerMultiple_TokenRewardAdded_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: loarLpLockerMultipleAbi,
    eventName: 'TokenRewardAdded',
  });

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__
 */
export const useLoarToken_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"BPS_DENOMINATOR"`
 */
export const useLoarToken_BpsDenominator_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'BPS_DENOMINATOR',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"DOMAIN_SEPARATOR"`
 */
export const useLoarToken_DomainSeparator_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'DOMAIN_SEPARATOR',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"MAX_FEE_INCREASE_PER_CHANGE"`
 */
export const useLoarToken_MaxFeeIncreasePerChange_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'MAX_FEE_INCREASE_PER_CHANGE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"MAX_SUPPLY"`
 */
export const useLoarToken_MaxSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'MAX_SUPPLY',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"MAX_TRANSFER_FEE_BPS"`
 */
export const useLoarToken_MaxTransferFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'MAX_TRANSFER_FEE_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"allowance"`
 */
export const useLoarToken_Allowance_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'allowance',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useLoarToken_BalanceOf_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'balanceOf',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"decimals"`
 */
export const useLoarToken_Decimals_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'decimals',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"eip712Domain"`
 */
export const useLoarToken_Eip712Domain_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'eip712Domain',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"feeExempt"`
 */
export const useLoarToken_FeeExempt_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'feeExempt',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"liquidityPool"`
 */
export const useLoarToken_LiquidityPool_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'liquidityPool',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"minters"`
 */
export const useLoarToken_Minters_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'minters',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"name"`
 */
export const useLoarToken_Name_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'name',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"nonces"`
 */
export const useLoarToken_Nonces_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'nonces',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"owner"`
 */
export const useLoarToken_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"symbol"`
 */
export const useLoarToken_Symbol_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'symbol',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"totalSupply"`
 */
export const useLoarToken_TotalSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'totalSupply',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transferFeeBps"`
 */
export const useLoarToken_TransferFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'transferFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"treasury"`
 */
export const useLoarToken_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: loarTokenAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__
 */
export const useLoarToken_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"approve"`
 */
export const useLoarToken_Approve_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"batchSetFeeExempt"`
 */
export const useLoarToken_BatchSetFeeExempt_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'batchSetFeeExempt',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"burn"`
 */
export const useLoarToken_Burn_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'burn',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"burnFrom"`
 */
export const useLoarToken_BurnFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'burnFrom',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"mint"`
 */
export const useLoarToken_Mint_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'mint',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"permit"`
 */
export const useLoarToken_Permit_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'permit',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarToken_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setFeeExempt"`
 */
export const useLoarToken_SetFeeExempt_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'setFeeExempt',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useLoarToken_SetLiquidityPool_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setMinter"`
 */
export const useLoarToken_SetMinter_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'setMinter',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setTransferFeeBps"`
 */
export const useLoarToken_SetTransferFeeBps_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'setTransferFeeBps',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useLoarToken_SetTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transfer"`
 */
export const useLoarToken_Transfer_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'transfer',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useLoarToken_TransferFrom_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarToken_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: loarTokenAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__
 */
export const useLoarToken_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"approve"`
 */
export const useLoarToken_Approve_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'approve',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"batchSetFeeExempt"`
 */
export const useLoarToken_BatchSetFeeExempt_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'batchSetFeeExempt',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"burn"`
 */
export const useLoarToken_Burn_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'burn',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"burnFrom"`
 */
export const useLoarToken_BurnFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'burnFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"mint"`
 */
export const useLoarToken_Mint_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'mint',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"permit"`
 */
export const useLoarToken_Permit_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'permit',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useLoarToken_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setFeeExempt"`
 */
export const useLoarToken_SetFeeExempt_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'setFeeExempt',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useLoarToken_SetLiquidityPool_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setMinter"`
 */
export const useLoarToken_SetMinter_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'setMinter',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setTransferFeeBps"`
 */
export const useLoarToken_SetTransferFeeBps_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'setTransferFeeBps',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useLoarToken_SetTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transfer"`
 */
export const useLoarToken_Transfer_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'transfer',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useLoarToken_TransferFrom_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'transferFrom',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link loarTokenAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useLoarToken_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: loarTokenAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__
 */
export const useLoarToken_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"Approval"`
 */
export const useLoarToken_Approval_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'Approval',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"EIP712DomainChanged"`
 */
export const useLoarToken_Eip712DomainChanged_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'EIP712DomainChanged',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"FeeExemptUpdated"`
 */
export const useLoarToken_FeeExemptUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'FeeExemptUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"LiquidityFeeCollected"`
 */
export const useLoarToken_LiquidityFeeCollected_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'LiquidityFeeCollected',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"LiquidityPoolUpdated"`
 */
export const useLoarToken_LiquidityPoolUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'LiquidityPoolUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"MinterUpdated"`
 */
export const useLoarToken_MinterUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'MinterUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useLoarToken_OwnershipTransferred_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'OwnershipTransferred',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"Transfer"`
 */
export const useLoarToken_Transfer_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'Transfer',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"TransferFeeUpdated"`
 */
export const useLoarToken_TransferFeeUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'TransferFeeUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link loarTokenAbi}__ and `eventName` set to `"TreasuryUpdated"`
 */
export const useLoarToken_TreasuryUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: loarTokenAbi,
  eventName: 'TreasuryUpdated',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__
 */
export const usePaymentRouter_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const usePaymentRouter_UpgradeInterfaceVersion_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'UPGRADE_INTERFACE_VERSION',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"USE_DEFAULT_FEE"`
 */
export const usePaymentRouter_UseDefaultFee_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'USE_DEFAULT_FEE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"claimable"`
 */
export const usePaymentRouter_Claimable_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'claimable',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"claimableLoar"`
 */
export const usePaymentRouter_ClaimableLoar_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'claimableLoar',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"defaultPlatformFeeBps"`
 */
export const usePaymentRouter_DefaultPlatformFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'defaultPlatformFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"loarFeeDiscountBps"`
 */
export const usePaymentRouter_LoarFeeDiscountBps_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'loarFeeDiscountBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"loarToken"`
 */
export const usePaymentRouter_LoarToken_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'loarToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"owner"`
 */
export const usePaymentRouter_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const usePaymentRouter_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"treasury"`
 */
export const usePaymentRouter_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: paymentRouterAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__
 */
export const usePaymentRouter_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"claim"`
 */
export const usePaymentRouter_Claim_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'claim',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"claimLoar"`
 */
export const usePaymentRouter_ClaimLoar_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'claimLoar',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"initialize"`
 */
export const usePaymentRouter_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const usePaymentRouter_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"route"`
 */
export const usePaymentRouter_Route_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'route',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"routeLoar"`
 */
export const usePaymentRouter_RouteLoar_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'routeLoar',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"routeLoarToTreasury"`
 */
export const usePaymentRouter_RouteLoarToTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'routeLoarToTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"routeToTreasury"`
 */
export const usePaymentRouter_RouteToTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'routeToTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setDefaultFee"`
 */
export const usePaymentRouter_SetDefaultFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'setDefaultFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setLoarFeeDiscount"`
 */
export const usePaymentRouter_SetLoarFeeDiscount_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'setLoarFeeDiscount',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setLoarToken"`
 */
export const usePaymentRouter_SetLoarToken_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'setLoarToken',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setTreasury"`
 */
export const usePaymentRouter_SetTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const usePaymentRouter_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const usePaymentRouter_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: paymentRouterAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__
 */
export const usePaymentRouter_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"claim"`
 */
export const usePaymentRouter_Claim_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'claim',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"claimLoar"`
 */
export const usePaymentRouter_ClaimLoar_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'claimLoar',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"initialize"`
 */
export const usePaymentRouter_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const usePaymentRouter_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"route"`
 */
export const usePaymentRouter_Route_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'route',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"routeLoar"`
 */
export const usePaymentRouter_RouteLoar_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'routeLoar',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"routeLoarToTreasury"`
 */
export const usePaymentRouter_RouteLoarToTreasury_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: paymentRouterAbi,
    functionName: 'routeLoarToTreasury',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"routeToTreasury"`
 */
export const usePaymentRouter_RouteToTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'routeToTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setDefaultFee"`
 */
export const usePaymentRouter_SetDefaultFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'setDefaultFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setLoarFeeDiscount"`
 */
export const usePaymentRouter_SetLoarFeeDiscount_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: paymentRouterAbi,
    functionName: 'setLoarFeeDiscount',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setLoarToken"`
 */
export const usePaymentRouter_SetLoarToken_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'setLoarToken',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"setTreasury"`
 */
export const usePaymentRouter_SetTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const usePaymentRouter_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link paymentRouterAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const usePaymentRouter_UpgradeToAndCall_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: paymentRouterAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__
 */
export const usePaymentRouter_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"Claimed"`
 */
export const usePaymentRouter_Claimed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'Claimed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"DefaultFeeUpdated"`
 */
export const usePaymentRouter_DefaultFeeUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'DefaultFeeUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"Initialized"`
 */
export const usePaymentRouter_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"LoarClaimed"`
 */
export const usePaymentRouter_LoarClaimed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'LoarClaimed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"LoarFeeDiscountUpdated"`
 */
export const usePaymentRouter_LoarFeeDiscountUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: paymentRouterAbi,
    eventName: 'LoarFeeDiscountUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"LoarPaymentRouted"`
 */
export const usePaymentRouter_LoarPaymentRouted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'LoarPaymentRouted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"LoarTokenUpdated"`
 */
export const usePaymentRouter_LoarTokenUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'LoarTokenUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const usePaymentRouter_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: paymentRouterAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"PaymentRouted"`
 */
export const usePaymentRouter_PaymentRouted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'PaymentRouted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"TreasuryUpdated"`
 */
export const usePaymentRouter_TreasuryUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'TreasuryUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link paymentRouterAbi}__ and `eventName` set to `"Upgraded"`
 */
export const usePaymentRouter_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: paymentRouterAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__
 */
export const useRemixFees_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const useRemixFees_UpgradeInterfaceVersion_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'UPGRADE_INTERFACE_VERSION',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"creatorShareBps"`
 */
export const useRemixFees_CreatorShareBps_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'creatorShareBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"defaultRemixFee"`
 */
export const useRemixFees_DefaultRemixFee_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'defaultRemixFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"getRemixFee"`
 */
export const useRemixFees_GetRemixFee_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'getRemixFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"liquidityPool"`
 */
export const useRemixFees_LiquidityPool_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'liquidityPool',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"loarToken"`
 */
export const useRemixFees_LoarToken_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'loarToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"lpShareBps"`
 */
export const useRemixFees_LpShareBps_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'lpShareBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"minRemixFee"`
 */
export const useRemixFees_MinRemixFee_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'minRemixFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"owner"`
 */
export const useRemixFees_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"platform"`
 */
export const useRemixFees_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useRemixFees_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"totalRemixFees"`
 */
export const useRemixFees_TotalRemixFees_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'totalRemixFees',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"totalRemixes"`
 */
export const useRemixFees_TotalRemixes_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'totalRemixes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"totalToCreators"`
 */
export const useRemixFees_TotalToCreators_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'totalToCreators',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"totalToLp"`
 */
export const useRemixFees_TotalToLp_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'totalToLp',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"treasury"`
 */
export const useRemixFees_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"treasuryShareBps"`
 */
export const useRemixFees_TreasuryShareBps_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'treasuryShareBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"universeConfigs"`
 */
export const useRemixFees_UniverseConfigs_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'universeConfigs',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"universeCreators"`
 */
export const useRemixFees_UniverseCreators_read = /*#__PURE__*/ createUseReadContract({
  abi: remixFeesAbi,
  functionName: 'universeCreators',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__
 */
export const useRemixFees_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"chargeRemixFee"`
 */
export const useRemixFees_ChargeRemixFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'chargeRemixFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"initialize"`
 */
export const useRemixFees_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"registerUniverse"`
 */
export const useRemixFees_RegisterUniverse_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'registerUniverse',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useRemixFees_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setDefaultRemixFee"`
 */
export const useRemixFees_SetDefaultRemixFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setDefaultRemixFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useRemixFees_SetLiquidityPool_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setMinRemixFee"`
 */
export const useRemixFees_SetMinRemixFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setMinRemixFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setPlatform"`
 */
export const useRemixFees_SetPlatform_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setPlatform',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setSplitRatios"`
 */
export const useRemixFees_SetSplitRatios_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setSplitRatios',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useRemixFees_SetTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setUniverseRemixFee"`
 */
export const useRemixFees_SetUniverseRemixFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'setUniverseRemixFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useRemixFees_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useRemixFees_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: remixFeesAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__
 */
export const useRemixFees_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"chargeRemixFee"`
 */
export const useRemixFees_ChargeRemixFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'chargeRemixFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"initialize"`
 */
export const useRemixFees_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"registerUniverse"`
 */
export const useRemixFees_RegisterUniverse_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'registerUniverse',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useRemixFees_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setDefaultRemixFee"`
 */
export const useRemixFees_SetDefaultRemixFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setDefaultRemixFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setLiquidityPool"`
 */
export const useRemixFees_SetLiquidityPool_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setLiquidityPool',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setMinRemixFee"`
 */
export const useRemixFees_SetMinRemixFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setMinRemixFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setPlatform"`
 */
export const useRemixFees_SetPlatform_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setPlatform',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setSplitRatios"`
 */
export const useRemixFees_SetSplitRatios_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setSplitRatios',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useRemixFees_SetTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"setUniverseRemixFee"`
 */
export const useRemixFees_SetUniverseRemixFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'setUniverseRemixFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useRemixFees_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link remixFeesAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useRemixFees_UpgradeToAndCall_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: remixFeesAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__
 */
export const useRemixFees_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__ and `eventName` set to `"DefaultRemixFeeUpdated"`
 */
export const useRemixFees_DefaultRemixFeeUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
  eventName: 'DefaultRemixFeeUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__ and `eventName` set to `"Initialized"`
 */
export const useRemixFees_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useRemixFees_OwnershipTransferred_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
  eventName: 'OwnershipTransferred',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__ and `eventName` set to `"RemixFeeCharged"`
 */
export const useRemixFees_RemixFeeCharged_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
  eventName: 'RemixFeeCharged',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__ and `eventName` set to `"UniverseRemixFeeSet"`
 */
export const useRemixFees_UniverseRemixFeeSet_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
  eventName: 'UniverseRemixFeeSet',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link remixFeesAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useRemixFees_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: remixFeesAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__
 */
export const useSlopMarket_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"MAX_FEE_BPS"`
 */
export const useSlopMarket_MaxFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'MAX_FEE_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"activeERC721Listing"`
 */
export const useSlopMarket_ActiveErc721Listing_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'activeERC721Listing',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"getListing"`
 */
export const useSlopMarket_GetListing_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'getListing',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"getSellerListings"`
 */
export const useSlopMarket_GetSellerListings_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'getSellerListings',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"listings"`
 */
export const useSlopMarket_Listings_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'listings',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"nextListingId"`
 */
export const useSlopMarket_NextListingId_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'nextListingId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"owner"`
 */
export const useSlopMarket_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"paymentRouter"`
 */
export const useSlopMarket_PaymentRouter_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'paymentRouter',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"platform"`
 */
export const useSlopMarket_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"platformFeeBps"`
 */
export const useSlopMarket_PlatformFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'platformFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"rightsRegistry"`
 */
export const useSlopMarket_RightsRegistry_read = /*#__PURE__*/ createUseReadContract({
  abi: slopMarketAbi,
  functionName: 'rightsRegistry',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__
 */
export const useSlopMarket_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"buy"`
 */
export const useSlopMarket_Buy_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'buy',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"delist"`
 */
export const useSlopMarket_Delist_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'delist',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"list"`
 */
export const useSlopMarket_List_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'list',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSlopMarket_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"setPaymentRouter"`
 */
export const useSlopMarket_SetPaymentRouter_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'setPaymentRouter',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"setPlatformFee"`
 */
export const useSlopMarket_SetPlatformFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'setPlatformFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSlopMarket_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: slopMarketAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__
 */
export const useSlopMarket_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"buy"`
 */
export const useSlopMarket_Buy_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'buy',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"delist"`
 */
export const useSlopMarket_Delist_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'delist',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"list"`
 */
export const useSlopMarket_List_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'list',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSlopMarket_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"setPaymentRouter"`
 */
export const useSlopMarket_SetPaymentRouter_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'setPaymentRouter',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"setPlatformFee"`
 */
export const useSlopMarket_SetPlatformFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'setPlatformFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link slopMarketAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSlopMarket_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: slopMarketAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link slopMarketAbi}__
 */
export const useSlopMarket_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: slopMarketAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link slopMarketAbi}__ and `eventName` set to `"Delisted"`
 */
export const useSlopMarket_Delisted_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: slopMarketAbi,
  eventName: 'Delisted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link slopMarketAbi}__ and `eventName` set to `"Listed"`
 */
export const useSlopMarket_Listed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: slopMarketAbi,
  eventName: 'Listed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link slopMarketAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useSlopMarket_OwnershipTransferred_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: slopMarketAbi,
  eventName: 'OwnershipTransferred',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link slopMarketAbi}__ and `eventName` set to `"PlatformFeeUpdated"`
 */
export const useSlopMarket_PlatformFeeUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: slopMarketAbi,
  eventName: 'PlatformFeeUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link slopMarketAbi}__ and `eventName` set to `"Sale"`
 */
export const useSlopMarket_Sale_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: slopMarketAbi,
  eventName: 'Sale',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__
 */
export const useStoryBounties_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"MAX_DEADLINE"`
 */
export const useStoryBounties_MaxDeadline_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'MAX_DEADLINE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const useStoryBounties_UpgradeInterfaceVersion_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'UPGRADE_INTERFACE_VERSION',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"bounties"`
 */
export const useStoryBounties_Bounties_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'bounties',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"cancellationFeeBps"`
 */
export const useStoryBounties_CancellationFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'cancellationFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"getBounty"`
 */
export const useStoryBounties_GetBounty_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'getBounty',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"getUniverseBounties"`
 */
export const useStoryBounties_GetUniverseBounties_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'getUniverseBounties',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"loarToken"`
 */
export const useStoryBounties_LoarToken_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'loarToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"minBountyAmount"`
 */
export const useStoryBounties_MinBountyAmount_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'minBountyAmount',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"nextBountyId"`
 */
export const useStoryBounties_NextBountyId_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'nextBountyId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"owner"`
 */
export const useStoryBounties_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"platform"`
 */
export const useStoryBounties_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"platformFeeBps"`
 */
export const useStoryBounties_PlatformFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'platformFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useStoryBounties_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"totalBounties"`
 */
export const useStoryBounties_TotalBounties_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'totalBounties',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"totalDistributed"`
 */
export const useStoryBounties_TotalDistributed_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'totalDistributed',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"treasury"`
 */
export const useStoryBounties_Treasury_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'treasury',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"universeBounties"`
 */
export const useStoryBounties_UniverseBounties_read = /*#__PURE__*/ createUseReadContract({
  abi: storyBountiesAbi,
  functionName: 'universeBounties',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__
 */
export const useStoryBounties_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"awardBounty"`
 */
export const useStoryBounties_AwardBounty_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'awardBounty',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"cancelBounty"`
 */
export const useStoryBounties_CancelBounty_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'cancelBounty',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"createBounty"`
 */
export const useStoryBounties_CreateBounty_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'createBounty',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"expireBounty"`
 */
export const useStoryBounties_ExpireBounty_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'expireBounty',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"initialize"`
 */
export const useStoryBounties_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useStoryBounties_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setCancellationFee"`
 */
export const useStoryBounties_SetCancellationFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'setCancellationFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setMinBountyAmount"`
 */
export const useStoryBounties_SetMinBountyAmount_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'setMinBountyAmount',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setPlatform"`
 */
export const useStoryBounties_SetPlatform_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'setPlatform',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setPlatformFee"`
 */
export const useStoryBounties_SetPlatformFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'setPlatformFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useStoryBounties_SetTreasury_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useStoryBounties_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useStoryBounties_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: storyBountiesAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__
 */
export const useStoryBounties_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"awardBounty"`
 */
export const useStoryBounties_AwardBounty_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'awardBounty',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"cancelBounty"`
 */
export const useStoryBounties_CancelBounty_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'cancelBounty',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"createBounty"`
 */
export const useStoryBounties_CreateBounty_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'createBounty',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"expireBounty"`
 */
export const useStoryBounties_ExpireBounty_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'expireBounty',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"initialize"`
 */
export const useStoryBounties_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useStoryBounties_RenounceOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setCancellationFee"`
 */
export const useStoryBounties_SetCancellationFee_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: storyBountiesAbi,
    functionName: 'setCancellationFee',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setMinBountyAmount"`
 */
export const useStoryBounties_SetMinBountyAmount_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: storyBountiesAbi,
    functionName: 'setMinBountyAmount',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setPlatform"`
 */
export const useStoryBounties_SetPlatform_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'setPlatform',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setPlatformFee"`
 */
export const useStoryBounties_SetPlatformFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'setPlatformFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"setTreasury"`
 */
export const useStoryBounties_SetTreasury_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'setTreasury',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useStoryBounties_TransferOwnership_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link storyBountiesAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useStoryBounties_UpgradeToAndCall_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: storyBountiesAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__
 */
export const useStoryBounties_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"BountyCancelled"`
 */
export const useStoryBounties_BountyCancelled_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
  eventName: 'BountyCancelled',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"BountyClaimed"`
 */
export const useStoryBounties_BountyClaimed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
  eventName: 'BountyClaimed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"BountyCreated"`
 */
export const useStoryBounties_BountyCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
  eventName: 'BountyCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"BountyExpired"`
 */
export const useStoryBounties_BountyExpired_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
  eventName: 'BountyExpired',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"Initialized"`
 */
export const useStoryBounties_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useStoryBounties_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: storyBountiesAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link storyBountiesAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useStoryBounties_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: storyBountiesAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__
 */
export const useSubscriptionManager_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"MAX_FEE_BPS"`
 */
export const useSubscriptionManager_MaxFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'MAX_FEE_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"UPGRADE_INTERFACE_VERSION"`
 */
export const useSubscriptionManager_UpgradeInterfaceVersion_read =
  /*#__PURE__*/ createUseReadContract({
    abi: subscriptionManagerAbi,
    functionName: 'UPGRADE_INTERFACE_VERSION',
  });

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"getSubscription"`
 */
export const useSubscriptionManager_GetSubscription_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'getSubscription',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"hasAccess"`
 */
export const useSubscriptionManager_HasAccess_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'hasAccess',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"owner"`
 */
export const useSubscriptionManager_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"paymentRouter"`
 */
export const useSubscriptionManager_PaymentRouter_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'paymentRouter',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"platform"`
 */
export const useSubscriptionManager_Platform_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'platform',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"platformFeeBps"`
 */
export const useSubscriptionManager_PlatformFeeBps_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'platformFeeBps',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useSubscriptionManager_ProxiableUuid_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'proxiableUUID',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"subscriberCount"`
 */
export const useSubscriptionManager_SubscriberCount_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'subscriberCount',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"subscriptions"`
 */
export const useSubscriptionManager_Subscriptions_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'subscriptions',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"tierConfigs"`
 */
export const useSubscriptionManager_TierConfigs_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'tierConfigs',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"universeCreators"`
 */
export const useSubscriptionManager_UniverseCreators_read = /*#__PURE__*/ createUseReadContract({
  abi: subscriptionManagerAbi,
  functionName: 'universeCreators',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__
 */
export const useSubscriptionManager_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"cancelSubscription"`
 */
export const useSubscriptionManager_CancelSubscription_write = /*#__PURE__*/ createUseWriteContract(
  {
    abi: subscriptionManagerAbi,
    functionName: 'cancelSubscription',
  }
);

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"configureTier"`
 */
export const useSubscriptionManager_ConfigureTier_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'configureTier',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useSubscriptionManager_Initialize_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"registerUniverse"`
 */
export const useSubscriptionManager_RegisterUniverse_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'registerUniverse',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSubscriptionManager_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"subscribe"`
 */
export const useSubscriptionManager_Subscribe_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'subscribe',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSubscriptionManager_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSubscriptionManager_UpgradeToAndCall_write = /*#__PURE__*/ createUseWriteContract({
  abi: subscriptionManagerAbi,
  functionName: 'upgradeToAndCall',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__
 */
export const useSubscriptionManager_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: subscriptionManagerAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"cancelSubscription"`
 */
export const useSubscriptionManager_CancelSubscription_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: subscriptionManagerAbi,
    functionName: 'cancelSubscription',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"configureTier"`
 */
export const useSubscriptionManager_ConfigureTier_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: subscriptionManagerAbi,
    functionName: 'configureTier',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useSubscriptionManager_Initialize_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: subscriptionManagerAbi,
  functionName: 'initialize',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"registerUniverse"`
 */
export const useSubscriptionManager_RegisterUniverse_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: subscriptionManagerAbi,
    functionName: 'registerUniverse',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSubscriptionManager_RenounceOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: subscriptionManagerAbi,
    functionName: 'renounceOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"subscribe"`
 */
export const useSubscriptionManager_Subscribe_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: subscriptionManagerAbi,
  functionName: 'subscribe',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSubscriptionManager_TransferOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: subscriptionManagerAbi,
    functionName: 'transferOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSubscriptionManager_UpgradeToAndCall_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: subscriptionManagerAbi,
    functionName: 'upgradeToAndCall',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__
 */
export const useSubscriptionManager_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: subscriptionManagerAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"Initialized"`
 */
export const useSubscriptionManager_Initialized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: subscriptionManagerAbi,
  eventName: 'Initialized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useSubscriptionManager_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: subscriptionManagerAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"Subscribed"`
 */
export const useSubscriptionManager_Subscribed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: subscriptionManagerAbi,
  eventName: 'Subscribed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"SubscriptionCancelled"`
 */
export const useSubscriptionManager_SubscriptionCancelled_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: subscriptionManagerAbi,
    eventName: 'SubscriptionCancelled',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"SubscriptionRenewed"`
 */
export const useSubscriptionManager_SubscriptionRenewed_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: subscriptionManagerAbi,
    eventName: 'SubscriptionRenewed',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"TierConfigured"`
 */
export const useSubscriptionManager_TierConfigured_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: subscriptionManagerAbi,
    eventName: 'TierConfigured',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"UniverseRegistered"`
 */
export const useSubscriptionManager_UniverseRegistered_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: subscriptionManagerAbi,
    eventName: 'UniverseRegistered',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link subscriptionManagerAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useSubscriptionManager_Upgraded_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: subscriptionManagerAbi,
  eventName: 'Upgraded',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__
 */
export const useUniverse_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"associatedToken"`
 */
export const useUniverse_AssociatedToken_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'associatedToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"currentCanonId"`
 */
export const useUniverse_CurrentCanonId_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'currentCanonId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getAdmin"`
 */
export const useUniverse_GetAdmin_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getAdmin',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getCanonChain"`
 */
export const useUniverse_GetCanonChain_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getCanonChain',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getFullGraph"`
 */
export const useUniverse_GetFullGraph_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getFullGraph',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getLeaves"`
 */
export const useUniverse_GetLeaves_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getLeaves',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getMedia"`
 */
export const useUniverse_GetMedia_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getMedia',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getNode"`
 */
export const useUniverse_GetNode_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getNode',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getTimeline"`
 */
export const useUniverse_GetTimeline_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getTimeline',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getToken"`
 */
export const useUniverse_GetToken_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getToken',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getVaultWhitelisted"`
 */
export const useUniverse_GetVaultWhitelisted_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getVaultWhitelisted',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"getWhitelisted"`
 */
export const useUniverse_GetWhitelisted_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'getWhitelisted',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"latestNodeId"`
 */
export const useUniverse_LatestNodeId_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'latestNodeId',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"nodeIDToHex"`
 */
export const useUniverse_NodeIdToHex_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'nodeIDToHex',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"nodes"`
 */
export const useUniverse_Nodes_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'nodes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"universeAdmin"`
 */
export const useUniverse_UniverseAdmin_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'universeAdmin',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"universeDescription"`
 */
export const useUniverse_UniverseDescription_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'universeDescription',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"universeImageUrl"`
 */
export const useUniverse_UniverseImageUrl_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'universeImageUrl',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"universeManager"`
 */
export const useUniverse_UniverseManager_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'universeManager',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"universeName"`
 */
export const useUniverse_UniverseName_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'universeName',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"vaultWhitelisted"`
 */
export const useUniverse_VaultWhitelisted_read = /*#__PURE__*/ createUseReadContract({
  abi: universeAbi,
  functionName: 'vaultWhitelisted',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__
 */
export const useUniverse_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"createNode"`
 */
export const useUniverse_CreateNode_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'createNode',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setAdmin"`
 */
export const useUniverse_SetAdmin_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setAdmin',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setCanon"`
 */
export const useUniverse_SetCanon_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setCanon',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setMedia"`
 */
export const useUniverse_SetMedia_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setMedia',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setNodeCreationOption"`
 */
export const useUniverse_SetNodeCreationOption_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setNodeCreationOption',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setNodeVisibilityOption"`
 */
export const useUniverse_SetNodeVisibilityOption_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setNodeVisibilityOption',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setToken"`
 */
export const useUniverse_SetToken_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setToken',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setVaultWhitelisted"`
 */
export const useUniverse_SetVaultWhitelisted_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setVaultWhitelisted',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setWhitelisted"`
 */
export const useUniverse_SetWhitelisted_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeAbi,
  functionName: 'setWhitelisted',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__
 */
export const useUniverse_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"createNode"`
 */
export const useUniverse_CreateNode_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'createNode',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setAdmin"`
 */
export const useUniverse_SetAdmin_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setAdmin',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setCanon"`
 */
export const useUniverse_SetCanon_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setCanon',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setMedia"`
 */
export const useUniverse_SetMedia_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setMedia',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setNodeCreationOption"`
 */
export const useUniverse_SetNodeCreationOption_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setNodeCreationOption',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setNodeVisibilityOption"`
 */
export const useUniverse_SetNodeVisibilityOption_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: universeAbi,
    functionName: 'setNodeVisibilityOption',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setToken"`
 */
export const useUniverse_SetToken_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setToken',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setVaultWhitelisted"`
 */
export const useUniverse_SetVaultWhitelisted_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setVaultWhitelisted',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeAbi}__ and `functionName` set to `"setWhitelisted"`
 */
export const useUniverse_SetWhitelisted_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeAbi,
  functionName: 'setWhitelisted',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__
 */
export const useUniverse_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"AdminUpdated"`
 */
export const useUniverse_AdminUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'AdminUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"MediaUpdated"`
 */
export const useUniverse_MediaUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'MediaUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"NodeCanonized"`
 */
export const useUniverse_NodeCanonized_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'NodeCanonized',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"NodeCreated"`
 */
export const useUniverse_NodeCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'NodeCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"NodeCreationOptionUpdated"`
 */
export const useUniverse_NodeCreationOptionUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeAbi,
    eventName: 'NodeCreationOptionUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"NodeVisibilityOptionUpdated"`
 */
export const useUniverse_NodeVisibilityOptionUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeAbi,
    eventName: 'NodeVisibilityOptionUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"TokenUpdated"`
 */
export const useUniverse_TokenUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'TokenUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"VaultWhitelistUpdated"`
 */
export const useUniverse_VaultWhitelistUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'VaultWhitelistUpdated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeAbi}__ and `eventName` set to `"WhitelistedUpdated"`
 */
export const useUniverse_WhitelistedUpdated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeAbi,
  eventName: 'WhitelistedUpdated',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__
 */
export const useUniverseGovernor_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"BALLOT_TYPEHASH"`
 */
export const useUniverseGovernor_BallotTypehash_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'BALLOT_TYPEHASH',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"CLOCK_MODE"`
 */
export const useUniverseGovernor_ClockMode_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'CLOCK_MODE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"COUNTING_MODE"`
 */
export const useUniverseGovernor_CountingMode_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'COUNTING_MODE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"EXTENDED_BALLOT_TYPEHASH"`
 */
export const useUniverseGovernor_ExtendedBallotTypehash_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'EXTENDED_BALLOT_TYPEHASH',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"clock"`
 */
export const useUniverseGovernor_Clock_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'clock',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"eip712Domain"`
 */
export const useUniverseGovernor_Eip712Domain_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'eip712Domain',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"getVotes"`
 */
export const useUniverseGovernor_GetVotes_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'getVotes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"getVotesWithParams"`
 */
export const useUniverseGovernor_GetVotesWithParams_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'getVotesWithParams',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"hasVoted"`
 */
export const useUniverseGovernor_HasVoted_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'hasVoted',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"hashProposal"`
 */
export const useUniverseGovernor_HashProposal_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'hashProposal',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"name"`
 */
export const useUniverseGovernor_Name_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'name',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"nonces"`
 */
export const useUniverseGovernor_Nonces_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'nonces',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalDeadline"`
 */
export const useUniverseGovernor_ProposalDeadline_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalDeadline',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalEta"`
 */
export const useUniverseGovernor_ProposalEta_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalEta',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalNeedsQueuing"`
 */
export const useUniverseGovernor_ProposalNeedsQueuing_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalNeedsQueuing',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalProposer"`
 */
export const useUniverseGovernor_ProposalProposer_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalProposer',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalSnapshot"`
 */
export const useUniverseGovernor_ProposalSnapshot_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalSnapshot',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalThreshold"`
 */
export const useUniverseGovernor_ProposalThreshold_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalThreshold',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"proposalVotes"`
 */
export const useUniverseGovernor_ProposalVotes_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'proposalVotes',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"quorum"`
 */
export const useUniverseGovernor_Quorum_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'quorum',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"quorumDenominator"`
 */
export const useUniverseGovernor_QuorumDenominator_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'quorumDenominator',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"quorumNumerator"`
 */
export const useUniverseGovernor_QuorumNumerator_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'quorumNumerator',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"state"`
 */
export const useUniverseGovernor_State_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'state',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useUniverseGovernor_SupportsInterface_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'supportsInterface',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"token"`
 */
export const useUniverseGovernor_Token_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'token',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"version"`
 */
export const useUniverseGovernor_Version_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'version',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"votingDelay"`
 */
export const useUniverseGovernor_VotingDelay_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'votingDelay',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"votingPeriod"`
 */
export const useUniverseGovernor_VotingPeriod_read = /*#__PURE__*/ createUseReadContract({
  abi: universeGovernorAbi,
  functionName: 'votingPeriod',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__
 */
export const useUniverseGovernor_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"cancel"`
 */
export const useUniverseGovernor_Cancel_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'cancel',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVote"`
 */
export const useUniverseGovernor_CastVote_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'castVote',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteBySig"`
 */
export const useUniverseGovernor_CastVoteBySig_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'castVoteBySig',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteWithReason"`
 */
export const useUniverseGovernor_CastVoteWithReason_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'castVoteWithReason',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteWithReasonAndParams"`
 */
export const useUniverseGovernor_CastVoteWithReasonAndParams_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: universeGovernorAbi,
    functionName: 'castVoteWithReasonAndParams',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteWithReasonAndParamsBySig"`
 */
export const useUniverseGovernor_CastVoteWithReasonAndParamsBySig_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: universeGovernorAbi,
    functionName: 'castVoteWithReasonAndParamsBySig',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"execute"`
 */
export const useUniverseGovernor_Execute_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'execute',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useUniverseGovernor_OnErc1155BatchReceived_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: universeGovernorAbi,
    functionName: 'onERC1155BatchReceived',
  });

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useUniverseGovernor_OnErc1155Received_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'onERC1155Received',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"onERC721Received"`
 */
export const useUniverseGovernor_OnErc721Received_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'onERC721Received',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"propose"`
 */
export const useUniverseGovernor_Propose_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'propose',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"queue"`
 */
export const useUniverseGovernor_Queue_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'queue',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"relay"`
 */
export const useUniverseGovernor_Relay_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'relay',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"setProposalThreshold"`
 */
export const useUniverseGovernor_SetProposalThreshold_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'setProposalThreshold',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"setVotingDelay"`
 */
export const useUniverseGovernor_SetVotingDelay_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'setVotingDelay',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"setVotingPeriod"`
 */
export const useUniverseGovernor_SetVotingPeriod_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeGovernorAbi,
  functionName: 'setVotingPeriod',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"updateQuorumNumerator"`
 */
export const useUniverseGovernor_UpdateQuorumNumerator_write = /*#__PURE__*/ createUseWriteContract(
  {
    abi: universeGovernorAbi,
    functionName: 'updateQuorumNumerator',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__
 */
export const useUniverseGovernor_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"cancel"`
 */
export const useUniverseGovernor_Cancel_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'cancel',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVote"`
 */
export const useUniverseGovernor_CastVote_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'castVote',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteBySig"`
 */
export const useUniverseGovernor_CastVoteBySig_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'castVoteBySig',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteWithReason"`
 */
export const useUniverseGovernor_CastVoteWithReason_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'castVoteWithReason',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteWithReasonAndParams"`
 */
export const useUniverseGovernor_CastVoteWithReasonAndParams_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'castVoteWithReasonAndParams',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"castVoteWithReasonAndParamsBySig"`
 */
export const useUniverseGovernor_CastVoteWithReasonAndParamsBySig_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'castVoteWithReasonAndParamsBySig',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"execute"`
 */
export const useUniverseGovernor_Execute_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'execute',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useUniverseGovernor_OnErc1155BatchReceived_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'onERC1155BatchReceived',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useUniverseGovernor_OnErc1155Received_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'onERC1155Received',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"onERC721Received"`
 */
export const useUniverseGovernor_OnErc721Received_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'onERC721Received',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"propose"`
 */
export const useUniverseGovernor_Propose_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'propose',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"queue"`
 */
export const useUniverseGovernor_Queue_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'queue',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"relay"`
 */
export const useUniverseGovernor_Relay_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'relay',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"setProposalThreshold"`
 */
export const useUniverseGovernor_SetProposalThreshold_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'setProposalThreshold',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"setVotingDelay"`
 */
export const useUniverseGovernor_SetVotingDelay_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeGovernorAbi,
  functionName: 'setVotingDelay',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"setVotingPeriod"`
 */
export const useUniverseGovernor_SetVotingPeriod_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: universeGovernorAbi,
    functionName: 'setVotingPeriod',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeGovernorAbi}__ and `functionName` set to `"updateQuorumNumerator"`
 */
export const useUniverseGovernor_UpdateQuorumNumerator_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeGovernorAbi,
    functionName: 'updateQuorumNumerator',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__
 */
export const useUniverseGovernor_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeGovernorAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"EIP712DomainChanged"`
 */
export const useUniverseGovernor_Eip712DomainChanged_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeGovernorAbi,
    eventName: 'EIP712DomainChanged',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"ProposalCanceled"`
 */
export const useUniverseGovernor_ProposalCanceled_watch = /*#__PURE__*/ createUseWatchContractEvent(
  {
    abi: universeGovernorAbi,
    eventName: 'ProposalCanceled',
  }
);

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"ProposalCreated"`
 */
export const useUniverseGovernor_ProposalCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeGovernorAbi,
  eventName: 'ProposalCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"ProposalExecuted"`
 */
export const useUniverseGovernor_ProposalExecuted_watch = /*#__PURE__*/ createUseWatchContractEvent(
  {
    abi: universeGovernorAbi,
    eventName: 'ProposalExecuted',
  }
);

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"ProposalQueued"`
 */
export const useUniverseGovernor_ProposalQueued_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeGovernorAbi,
  eventName: 'ProposalQueued',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"ProposalThresholdSet"`
 */
export const useUniverseGovernor_ProposalThresholdSet_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeGovernorAbi,
    eventName: 'ProposalThresholdSet',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"QuorumNumeratorUpdated"`
 */
export const useUniverseGovernor_QuorumNumeratorUpdated_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeGovernorAbi,
    eventName: 'QuorumNumeratorUpdated',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"VoteCast"`
 */
export const useUniverseGovernor_VoteCast_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeGovernorAbi,
  eventName: 'VoteCast',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"VoteCastWithParams"`
 */
export const useUniverseGovernor_VoteCastWithParams_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeGovernorAbi,
    eventName: 'VoteCastWithParams',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"VotingDelaySet"`
 */
export const useUniverseGovernor_VotingDelaySet_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeGovernorAbi,
  eventName: 'VotingDelaySet',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeGovernorAbi}__ and `eventName` set to `"VotingPeriodSet"`
 */
export const useUniverseGovernor_VotingPeriodSet_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeGovernorAbi,
  eventName: 'VotingPeriodSet',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__
 */
export const useUniverseManager_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"BPS"`
 */
export const useUniverseManager_Bps_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"MINT_FEE"`
 */
export const useUniverseManager_MintFee_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'MINT_FEE',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"TOKEN_SUPPLY"`
 */
export const useUniverseManager_TokenSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'TOKEN_SUPPLY',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"deprecated"`
 */
export const useUniverseManager_Deprecated_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'deprecated',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"enabledHooks"`
 */
export const useUniverseManager_EnabledHooks_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'enabledHooks',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"enabledLockers"`
 */
export const useUniverseManager_EnabledLockers_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'enabledLockers',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"getUniverseData"`
 */
export const useUniverseManager_GetUniverseData_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'getUniverseData',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"lpRecipient"`
 */
export const useUniverseManager_LpRecipient_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'lpRecipient',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"owner"`
 */
export const useUniverseManager_Owner_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'owner',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"teamFee"`
 */
export const useUniverseManager_TeamFee_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'teamFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"teamFeeRecipient"`
 */
export const useUniverseManager_TeamFeeRecipient_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'teamFeeRecipient',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"tokenDeployer"`
 */
export const useUniverseManager_TokenDeployer_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'tokenDeployer',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"totalCreditFundsHeld"`
 */
export const useUniverseManager_TotalCreditFundsHeld_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'totalCreditFundsHeld',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"universeCreditFund"`
 */
export const useUniverseManager_UniverseCreditFund_read = /*#__PURE__*/ createUseReadContract({
  abi: universeManagerAbi,
  functionName: 'universeCreditFund',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__
 */
export const useUniverseManager_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"claimEth"`
 */
export const useUniverseManager_ClaimEth_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'claimEth',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"claimTeamFee"`
 */
export const useUniverseManager_ClaimTeamFee_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'claimTeamFee',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"consumeCreditFund"`
 */
export const useUniverseManager_ConsumeCreditFund_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'consumeCreditFund',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"createUniverse"`
 */
export const useUniverseManager_CreateUniverse_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'createUniverse',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"deployUniverseToken"`
 */
export const useUniverseManager_DeployUniverseToken_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'deployUniverseToken',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useUniverseManager_RenounceOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'renounceOwnership',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setDeprecated"`
 */
export const useUniverseManager_SetDeprecated_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'setDeprecated',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setHook"`
 */
export const useUniverseManager_SetHook_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'setHook',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setLocker"`
 */
export const useUniverseManager_SetLocker_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'setLocker',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setLpRecipient"`
 */
export const useUniverseManager_SetLpRecipient_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'setLpRecipient',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setTeamFeeRecipient"`
 */
export const useUniverseManager_SetTeamFeeRecipient_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'setTeamFeeRecipient',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setTokenDeployer"`
 */
export const useUniverseManager_SetTokenDeployer_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'setTokenDeployer',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useUniverseManager_TransferOwnership_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeManagerAbi,
  functionName: 'transferOwnership',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__
 */
export const useUniverseManager_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"claimEth"`
 */
export const useUniverseManager_ClaimEth_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'claimEth',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"claimTeamFee"`
 */
export const useUniverseManager_ClaimTeamFee_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'claimTeamFee',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"consumeCreditFund"`
 */
export const useUniverseManager_ConsumeCreditFund_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeManagerAbi,
    functionName: 'consumeCreditFund',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"createUniverse"`
 */
export const useUniverseManager_CreateUniverse_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'createUniverse',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"deployUniverseToken"`
 */
export const useUniverseManager_DeployUniverseToken_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeManagerAbi,
    functionName: 'deployUniverseToken',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useUniverseManager_RenounceOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeManagerAbi,
    functionName: 'renounceOwnership',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setDeprecated"`
 */
export const useUniverseManager_SetDeprecated_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'setDeprecated',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setHook"`
 */
export const useUniverseManager_SetHook_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'setHook',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setLocker"`
 */
export const useUniverseManager_SetLocker_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'setLocker',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setLpRecipient"`
 */
export const useUniverseManager_SetLpRecipient_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeManagerAbi,
  functionName: 'setLpRecipient',
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setTeamFeeRecipient"`
 */
export const useUniverseManager_SetTeamFeeRecipient_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeManagerAbi,
    functionName: 'setTeamFeeRecipient',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"setTokenDeployer"`
 */
export const useUniverseManager_SetTokenDeployer_simulate = /*#__PURE__*/ createUseSimulateContract(
  {
    abi: universeManagerAbi,
    functionName: 'setTokenDeployer',
  }
);

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useUniverseManager_TransferOwnership_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeManagerAbi,
    functionName: 'transferOwnership',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__
 */
export const useUniverseManager_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"ClaimTeamFees"`
 */
export const useUniverseManager_ClaimTeamFees_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'ClaimTeamFees',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useUniverseManager_OwnershipTransferred_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeManagerAbi,
    eventName: 'OwnershipTransferred',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"SetDeprecated"`
 */
export const useUniverseManager_SetDeprecated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'SetDeprecated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"SetHook"`
 */
export const useUniverseManager_SetHook_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'SetHook',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"SetLocker"`
 */
export const useUniverseManager_SetLocker_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'SetLocker',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"SetLpRecipient"`
 */
export const useUniverseManager_SetLpRecipient_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'SetLpRecipient',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"SetTeamFeeRecipient"`
 */
export const useUniverseManager_SetTeamFeeRecipient_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeManagerAbi,
    eventName: 'SetTeamFeeRecipient',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"SetTokenDeployer"`
 */
export const useUniverseManager_SetTokenDeployer_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'SetTokenDeployer',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"TokenCreated"`
 */
export const useUniverseManager_TokenCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'TokenCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"TokenDeployed"`
 */
export const useUniverseManager_TokenDeployed_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'TokenDeployed',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"UniverseCreated"`
 */
export const useUniverseManager_UniverseCreated_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'UniverseCreated',
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeManagerAbi}__ and `eventName` set to `"UniverseMintFee"`
 */
export const useUniverseManager_UniverseMintFee_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeManagerAbi,
  eventName: 'UniverseMintFee',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__
 */
export const useUniverseTokenDeployer_undefined_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"DEFAULT_COMMUNITY_BPS"`
 */
export const useUniverseTokenDeployer_DefaultCommunityBps_read =
  /*#__PURE__*/ createUseReadContract({
    abi: universeTokenDeployerAbi,
    functionName: 'DEFAULT_COMMUNITY_BPS',
  });

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"DEFAULT_CREATOR_BPS"`
 */
export const useUniverseTokenDeployer_DefaultCreatorBps_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'DEFAULT_CREATOR_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"DEFAULT_LP_BPS"`
 */
export const useUniverseTokenDeployer_DefaultLpBps_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'DEFAULT_LP_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"DEFAULT_TREASURY_BPS"`
 */
export const useUniverseTokenDeployer_DefaultTreasuryBps_read = /*#__PURE__*/ createUseReadContract(
  {
    abi: universeTokenDeployerAbi,
    functionName: 'DEFAULT_TREASURY_BPS',
  }
);

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"MAX_CREATOR_BPS"`
 */
export const useUniverseTokenDeployer_MaxCreatorBps_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'MAX_CREATOR_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"MIN_LP_BPS"`
 */
export const useUniverseTokenDeployer_MinLpBps_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'MIN_LP_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"MIN_TREASURY_BPS"`
 */
export const useUniverseTokenDeployer_MinTreasuryBps_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'MIN_TREASURY_BPS',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"TOKEN_SUPPLY"`
 */
export const useUniverseTokenDeployer_TokenSupply_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'TOKEN_SUPPLY',
});

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"universeManager"`
 */
export const useUniverseTokenDeployer_UniverseManager_read = /*#__PURE__*/ createUseReadContract({
  abi: universeTokenDeployerAbi,
  functionName: 'universeManager',
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__
 */
export const useUniverseTokenDeployer_undefined_write = /*#__PURE__*/ createUseWriteContract({
  abi: universeTokenDeployerAbi,
});

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"deployTokenAndGovernance"`
 */
export const useUniverseTokenDeployer_DeployTokenAndGovernance_write =
  /*#__PURE__*/ createUseWriteContract({
    abi: universeTokenDeployerAbi,
    functionName: 'deployTokenAndGovernance',
  });

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__
 */
export const useUniverseTokenDeployer_undefined_simulate = /*#__PURE__*/ createUseSimulateContract({
  abi: universeTokenDeployerAbi,
});

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `functionName` set to `"deployTokenAndGovernance"`
 */
export const useUniverseTokenDeployer_DeployTokenAndGovernance_simulate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: universeTokenDeployerAbi,
    functionName: 'deployTokenAndGovernance',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeTokenDeployerAbi}__
 */
export const useUniverseTokenDeployer_undefined_watch = /*#__PURE__*/ createUseWatchContractEvent({
  abi: universeTokenDeployerAbi,
});

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `eventName` set to `"TokenAllocation"`
 */
export const useUniverseTokenDeployer_TokenAllocation_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeTokenDeployerAbi,
    eventName: 'TokenAllocation',
  });

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link universeTokenDeployerAbi}__ and `eventName` set to `"TokenDeployed"`
 */
export const useUniverseTokenDeployer_TokenDeployed_watch =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: universeTokenDeployerAbi,
    eventName: 'TokenDeployed',
  });
